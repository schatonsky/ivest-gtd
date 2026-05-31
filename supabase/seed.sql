-- ============================================================
-- Interactive GTD — sample data (optional)
-- Run AFTER schema.sql to populate the board with demo content.
-- To start fresh later, run reset.sql (or the DELETEs at the bottom).
-- ============================================================

-- Projects
insert into projects (id, name, color) values
  ('11111111-1111-1111-1111-111111111101', 'Audit FY26',      '#3B6CF0'),
  ('11111111-1111-1111-1111-111111111102', 'Website refresh', '#0E9F6E'),
  ('11111111-1111-1111-1111-111111111103', 'Board meeting',   '#B45309'),
  ('11111111-1111-1111-1111-111111111104', 'Personal',        '#7C3AED')
on conflict (id) do nothing;

-- Contacts
insert into contacts (id, name, email) values
  ('22222222-2222-2222-2222-222222222201', 'David Lim',    'david.lim@auditpartners.com'),
  ('22222222-2222-2222-2222-222222222202', 'Pixel Studio', 'hello@pixelstudio.com'),
  ('22222222-2222-2222-2222-222222222203', 'Margaret Cho', 'm.cho@ivest.com.au')
on conflict (id) do nothing;

-- Action items
insert into action_items
  (id, title, description, status, return_status, project_id, contact_id, source, source_email_url, priority, due_date, created_by, assigned_to, created_at, updated_at, closed_at)
values
  ('33333333-3333-3333-3333-333333333301',
   'Set up FY26 audit kickoff meeting with David Lim',
   'Hi Nicole — please coordinate with David Lim to lock in a 60-minute audit kickoff in the first week of June. Boardroom or video both fine. Loop me in once two options are proposed.',
   'open', null, '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201',
   'email', 'https://mail.google.com/mail/u/0/#search/rfc822msgid', 'high', '2026-06-05',
   'stephane','nicole', now() - interval '55 minutes', now() - interval '55 minutes', null),

  ('33333333-3333-3333-3333-333333333302',
   'Collect three quotes for the website refresh',
   'Get three comparable quotes for refreshing the public site. Pixel Studio is one — find two others.',
   'in_progress', null, '11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222202',
   'manual', null, 'normal', '2026-06-12',
   'stephane','nicole', now() - interval '26 hours', now() - interval '3 hours', null),

  ('33333333-3333-3333-3333-333333333303',
   'Confirm catering headcount for the June board meeting',
   'Arrange catering for the board meeting. Please confirm numbers and any dietary needs.',
   'awaiting_principal', 'in_progress', '11111111-1111-1111-1111-111111111103', null,
   'email', 'https://mail.google.com/mail/u/0/#search/rfc822msgid', 'normal', '2026-06-02',
   'stephane','nicole', now() - interval '30 hours', now() - interval '40 minutes', null),

  ('33333333-3333-3333-3333-333333333304',
   'Draft the Q2 investor update outline',
   'Put together a one-page outline for the Q2 investor update so I can fill in the numbers.',
   'pending_review', null, '11111111-1111-1111-1111-111111111103', '22222222-2222-2222-2222-222222222203',
   'manual', null, 'high', '2026-05-30',
   'stephane','nicole', now() - interval '50 hours', now() - interval '5 hours', null),

  ('33333333-3333-3333-3333-333333333305',
   'Book flights for the Sydney investor roadshow',
   'Book return flights to Sydney for the roadshow week.',
   'follow_up', null, '11111111-1111-1111-1111-111111111104', null,
   'email', 'https://mail.google.com/mail/u/0/#search/rfc822msgid', 'normal', '2026-06-08',
   'stephane','nicole', now() - interval '72 hours', now() - interval '2 hours', null),

  ('33333333-3333-3333-3333-333333333306',
   'Renew the office parking permits',
   'Renew the three office parking permits before they expire end of May.',
   'closed', null, '11111111-1111-1111-1111-111111111104', null,
   'manual', null, 'low', null,
   'stephane','nicole', now() - interval '120 hours', now() - interval '40 hours', now() - interval '40 hours')
on conflict (id) do nothing;

-- Attach the original emails to the email-sourced items.
update action_items set
  email_from    = 'Stephane Chatonsky <stephane@chatonsky.com>',
  email_subject = 'FY26 audit kickoff with David Lim',
  email_date    = now() - interval '55 minutes',
  email_body    = E'Hi Nicole,\n\nPlease coordinate with David Lim to lock in a 60-minute audit kickoff in the first week of June. Boardroom or video both fine.\n\nLoop me in once you have two options to propose.\n\nThanks,\nStephane'
where id = '33333333-3333-3333-3333-333333333301';

update action_items set
  email_from    = 'Stephane Chatonsky <stephane@chatonsky.com>',
  email_subject = 'Catering for the June board meeting',
  email_date    = now() - interval '30 hours',
  email_body    = E'Hi Nicole,\n\nCan you arrange catering for the board meeting? Please confirm final numbers and check for any dietary requirements with the attendees.\n\nThanks,\nStephane'
where id = '33333333-3333-3333-3333-333333333303';

update action_items set
  email_from    = 'Stephane Chatonsky <stephane@chatonsky.com>',
  email_subject = 'Sydney investor roadshow — flights',
  email_date    = now() - interval '72 hours',
  email_body    = E'Hi Nicole,\n\nPlease book return flights to Sydney for the roadshow week. Aisle seat where possible.\n\nThanks,\nStephane'
where id = '33333333-3333-3333-3333-333333333305';

-- Comments / questions / answers
insert into comments (action_item_id, author, type, body, resolved, created_at) values
  ('33333333-3333-3333-3333-333333333302','nicole','comment','Pixel Studio quote received. Reaching out to two more agencies today.', false, now() - interval '3 hours'),
  ('33333333-3333-3333-3333-333333333303','nicole','comment','Caterer is booked. They need final numbers by Monday.', false, now() - interval '2 hours'),
  ('33333333-3333-3333-3333-333333333303','nicole','question','Will the two external advisors be attending in person, or dialling in? It changes the headcount.', false, now() - interval '40 minutes'),
  ('33333333-3333-3333-3333-333333333304','nicole','comment','Outline drafted and saved to the shared drive — sections for performance, pipeline, and outlook. Ready for your review.', false, now() - interval '5 hours'),
  ('33333333-3333-3333-3333-333333333305','nicole','comment','Booked the 8am outbound and 6pm return.', false, now() - interval '20 hours'),
  ('33333333-3333-3333-3333-333333333305','stephane','comment','Can you move the return to the following morning? I''d like to stay for the evening dinner.', false, now() - interval '2 hours'),
  ('33333333-3333-3333-3333-333333333306','nicole','comment','All three renewed and receipts filed.', false, now() - interval '44 hours');

-- Activity log
insert into activity_log (action_item_id, actor, change, created_at) values
  ('33333333-3333-3333-3333-333333333301','system','Created from GTD-labelled email', now() - interval '55 minutes'),
  ('33333333-3333-3333-3333-333333333302','stephane','Created manually', now() - interval '26 hours'),
  ('33333333-3333-3333-3333-333333333302','nicole','Started work', now() - interval '4 hours'),
  ('33333333-3333-3333-3333-333333333303','system','Created from GTD-labelled email', now() - interval '30 hours'),
  ('33333333-3333-3333-3333-333333333303','nicole','Question raised', now() - interval '40 minutes'),
  ('33333333-3333-3333-3333-333333333304','stephane','Created manually', now() - interval '50 hours'),
  ('33333333-3333-3333-3333-333333333304','nicole','Marked complete', now() - interval '5 hours'),
  ('33333333-3333-3333-3333-333333333305','system','Created from GTD-labelled email', now() - interval '72 hours'),
  ('33333333-3333-3333-3333-333333333305','stephane','Follow-up requested', now() - interval '2 hours'),
  ('33333333-3333-3333-3333-333333333306','stephane','Reviewed & closed', now() - interval '40 hours');

-- ------------------------------------------------------------
-- To clear all sample data later, run:
--   delete from activity_log; delete from comments; delete from action_items;
--   delete from contacts; delete from projects;
-- (profiles and auth users are left untouched.)
-- ------------------------------------------------------------
