// Questions shown on every profile page (Profile/profile.js). Add, reorder or
// reword freely: answers are stored by `id`, so keep an id the same once
// people have answered it. Removing a question hides its answers without
// deleting them. Ids: lowercase letters, numbers, underscores. Each answer
// is private until its owner flips it public.
//
// type: 'text' (default), 'long' (multi-line), 'number', 'date' or 'color'.
// max: character limit for text/long (default 140, server cap 500).
// integer / money: for numbers — whole numbers only, or shown as dollars.
// private: always private, with no toggle. The favorite colors are private
// answers, but they theme the page for everyone (supabase/public_profiles.sql
// sends them as `theme`, so keep these ids in step with it).
window.PROFILE_QUESTIONS = [
  { id: 'custom',       q: 'Custom - what do you want the world to know about you?', type: 'long', max: 500 },
  { id: 'fruit',        q: 'If you were a fruit, which would you be?' },
  { id: 'mom',          q: 'When was the last time you talked to your mom?' },
  { id: 'achievement',  q: 'Greatest achievement' },
  { id: 'marshmallows', q: 'Amount of marshmallows you can fit in your mouth', type: 'number', integer: true },
  { id: 'birthday',     q: 'Birthday', type: 'date' },
  { id: 'color1',       q: 'Favorite Color', type: 'color', private: true },
  { id: 'color2',       q: 'Second Favorite Color', type: 'color', private: true },
  { id: 'color3',       q: 'Third Favorite Color', type: 'color', private: true },
  { id: 'fav_page',     q: 'Favorite page on the site' },
  { id: 'wallet',       q: 'Contents of wallet/purse' },
  { id: 'residence',    q: 'Residence' }
];
