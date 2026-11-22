-- Puzzle cube gift orders. Paste into the Supabase SQL editor and run, after
-- comments.sql (which creates admins / is_admin()). Safe to re-run.
--
-- These are order *requests*: nobody pays on the site. A guest fills in
-- Light_Bulb_Factory/shop.html, the row lands here as 'requested', and Emmet
-- confirms by email and sends an invoice. Light_Bulb_Factory/orders.html is
-- the admin view.
--
-- The price is recomputed here from the options, so the number in the row is
-- the real one whatever the page sent. KEEP cube_order_price() IN SYNC WITH
-- the SHOP config at the top of Light_Bulb_Factory/shop.js (prices, stock
-- colors, letter limit).
--
-- Every new order emails you through Resend (see "Order emails" at the bottom).
-- One-time setup, run in the SQL editor (NOT saved in this file, since the
-- repo is public):
--   select vault.create_secret('re_xxxxxxxx', 'resend_api_key');
--   select vault.create_secret('you@example.com', 'order_notify_to');
-- To change one later: select vault.update_secret(
--   (select id from vault.secrets where name = 'resend_api_key'), 're_new...');

create table if not exists public.cube_orders (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  status          text not null default 'requested'
                  check (status in ('requested','confirmed','paid','printing','shipped','cancelled')),
  difficulty      text not null check (difficulty in ('medium','hard')),
  color           text not null check (char_length(color) between 1 and 40),
  color_custom    text check (char_length(color_custom) <= 200),
  message_type    text not null,
  message_text    text check (char_length(message_text) <= 40),
  quantity        int  not null check (quantity between 1 and 10),
  est_price_cents int  not null,
  name            text not null check (char_length(name) between 1 and 120),
  email           text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  delivery        text not null check (delivery in ('ship','pickup')),
  address         text check (char_length(address) <= 500),
  needed_by       date,
  notes           text check (char_length(notes) <= 1000),
  admin_notes     text check (char_length(admin_notes) <= 2000),
  user_id         uuid references auth.users on delete set null
);
create index if not exists cube_orders_created on public.cube_orders (created_at desc);
create index if not exists cube_orders_email on public.cube_orders (lower(email), created_at);

-- Message types: blank, surprise (Emmet picks), custom (buyer's words).
-- 'set' was an earlier option, renamed to surprise.
alter table public.cube_orders drop constraint if exists cube_orders_message_type_check;
update public.cube_orders set message_type = 'surprise', message_text = null where message_type = 'set';
alter table public.cube_orders add constraint cube_orders_message_type_check
  check (message_type in ('blank','surprise','custom'));

-- No policies: orders only come and go through the functions below.
alter table public.cube_orders enable row level security;

-- Price in cents for one line. Mirrors SHOP in shop.js.
create or replace function public.cube_order_price(
  p_difficulty text, p_custom_color boolean, p_message_type text,
  p_quantity int, p_delivery text)
returns int
language sql immutable as $$
  select (
      (case p_difficulty when 'medium' then 5000 when 'hard' then 5000 end)
    + (case when p_custom_color then 1000 else 0 end)
    + (case p_message_type when 'custom' then 1500 else 0 end)
  ) * p_quantity
  + (case p_delivery when 'ship' then 800 else 0 end);
$$;

-- Anyone (signed in or not) may ask for an order. Returns
-- { ok: true, id, price_cents } or { ok: false, reason }.
create or replace function public.submit_cube_order(
  p_difficulty   text,
  p_color        text,
  p_color_custom text,
  p_message_type text,
  p_message_text text,
  p_quantity     int,
  p_name         text,
  p_email        text,
  p_delivery     text,
  p_address      text,
  p_needed_by    date,
  p_notes        text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  stock_colors constant text[] := array['Midnight Black','Snow White','Holly Red','Pine Green','Ocean Blue','Gold'];
  max_letters  constant int := 14;
  v_custom boolean;
  v_msg    text := nullif(upper(btrim(coalesce(p_message_text, ''))), '');
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_price  int;
  v_id     bigint;
begin
  if p_difficulty not in ('medium','hard') then return jsonb_build_object('ok', false, 'reason', 'difficulty'); end if;
  if p_quantity is null or p_quantity not between 1 and 10 then return jsonb_build_object('ok', false, 'reason', 'quantity'); end if;
  if p_delivery not in ('ship','pickup') then return jsonb_build_object('ok', false, 'reason', 'delivery'); end if;
  if p_delivery = 'ship' and char_length(btrim(coalesce(p_address, ''))) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'address');
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'email'); end if;

  -- Color: a stock name, or 'custom' with a description.
  if p_color = 'custom' then
    if char_length(btrim(coalesce(p_color_custom, ''))) = 0 then return jsonb_build_object('ok', false, 'reason', 'color'); end if;
    v_custom := true;
  elsif p_color = any(stock_colors) then
    v_custom := false;
  else
    return jsonb_build_object('ok', false, 'reason', 'color');
  end if;

  -- Message: letters and digits only (spaces are just for reading), and no
  -- more than fit on the pieces.
  if p_message_type in ('blank', 'surprise') then
    v_msg := null;
  elsif p_message_type = 'custom' then
    if v_msg is null or v_msg !~ '^[A-Z0-9 ]+$'
       or char_length(replace(v_msg, ' ', '')) > max_letters then
      return jsonb_build_object('ok', false, 'reason', 'message');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'message');
  end if;

  -- A light brake on spam: five requests per email per day.
  if (select count(*) from cube_orders
      where lower(email) = v_email and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  v_price := cube_order_price(p_difficulty, v_custom, p_message_type, p_quantity, p_delivery);

  insert into cube_orders (difficulty, color, color_custom, message_type, message_text, quantity,
                           est_price_cents, name, email, delivery, address, needed_by, notes, user_id)
  values (p_difficulty, p_color, case when v_custom then left(btrim(p_color_custom), 200) end,
          p_message_type, v_msg, p_quantity, v_price,
          left(btrim(p_name), 120), v_email, p_delivery,
          case when p_delivery = 'ship' then left(btrim(p_address), 500) end,
          p_needed_by, nullif(left(btrim(coalesce(p_notes, '')), 1000), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'price_cents', v_price);
end;
$$;

-- Admin: every order, newest first.
create or replace function public.list_cube_orders()
returns setof public.cube_orders
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select * from cube_orders order by created_at desc;
end;
$$;

-- Admin: move an order along, and/or keep private notes on it.
create or replace function public.set_cube_order_status(p_id bigint, p_status text, p_admin_notes text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update cube_orders
     set status = p_status,
         admin_notes = coalesce(p_admin_notes, admin_notes)
   where id = p_id;
end;
$$;

revoke all on function public.submit_cube_order(text,text,text,text,text,int,text,text,text,text,date,text) from public;
grant execute on function public.submit_cube_order(text,text,text,text,text,int,text,text,text,text,date,text) to anon, authenticated;
revoke all on function public.list_cube_orders() from public;
grant execute on function public.list_cube_orders() to authenticated;
revoke all on function public.set_cube_order_status(bigint,text,text) from public;
grant execute on function public.set_cube_order_status(bigint,text,text) to authenticated;

-- ── Order emails ─────────────────────────────────────────────────────────
-- After each insert, POST to Resend's API with pg_net. The request is queued
-- and sent in the background, so the order saves even if the email fails;
-- failures show up in net._http_response:
--   select status_code, content from net._http_response order by created desc limit 5;
-- Sent from overseer.whatisemmetupto.com (the subdomain verified in Resend;
-- the bare whatisemmetupto.com is NOT verified) to the order_notify_to
-- inbox in the vault. Reply-To is the buyer, so hitting reply answers them.

create extension if not exists pg_net;

create or replace function public.html_escape(t text)
returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public.notify_cube_order()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key  text;
  v_to   text;
  v_rows text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into v_to  from vault.decrypted_secrets where name = 'order_notify_to';
  if v_key is null or v_to is null then return new; end if;   -- not set up yet

  v_rows := concat_ws('',
    '<tr><td><b>Cube</b></td><td>', new.quantity, ' &times; ', initcap(new.difficulty), '</td></tr>',
    '<tr><td><b>Color</b></td><td>', html_escape(case when new.color = 'custom' then 'Custom: ' || new.color_custom else new.color end), '</td></tr>',
    '<tr><td><b>Message</b></td><td>', html_escape(case new.message_type when 'blank' then 'Blank'
                                                     when 'surprise' then 'Surprise me (you pick)'
                                                     else 'Custom: ' || new.message_text end), '</td></tr>',
    '<tr><td><b>Delivery</b></td><td>', case when new.delivery = 'ship'
                                          then 'Ship to:<br>' || replace(html_escape(new.address), E'\n', '<br>')
                                          else 'Pickup' end, '</td></tr>',
    '<tr><td><b>Needed by</b></td><td>', coalesce(new.needed_by::text, '&mdash;'), '</td></tr>',
    '<tr><td><b>Name</b></td><td>', html_escape(new.name), '</td></tr>',
    '<tr><td><b>Email</b></td><td>', html_escape(new.email), '</td></tr>',
    '<tr><td><b>Notes</b></td><td>', coalesce(nullif(replace(html_escape(new.notes), E'\n', '<br>'), ''), '&mdash;'), '</td></tr>',
    '<tr><td><b>Estimate</b></td><td>$', to_char(new.est_price_cents / 100.0, 'FM999990.00'), '</td></tr>');

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from',     'Lightbulb Factory Orders <orders@overseer.whatisemmetupto.com>',
      'to',       jsonb_build_array(v_to),
      'reply_to', new.email,
      'subject',  format('🎁 Cube order #%s from %s ($%s)', new.id, new.name, to_char(new.est_price_cents / 100.0, 'FM999990.00')),
      'html',     '<h2>New puzzle cube order #' || new.id || '</h2>'
                  || '<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">' || v_rows || '</table>'
                  || '<p><a href="https://whatisemmetupto.com/Light_Bulb_Factory/orders.html">Open the orders page</a></p>'));
  return new;
exception when others then
  -- Never lose an order over an email.
  raise warning 'notify_cube_order failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_cube_order() from public;

drop trigger if exists cube_orders_notify on public.cube_orders;
create trigger cube_orders_notify
  after insert on public.cube_orders
  for each row execute function public.notify_cube_order();
