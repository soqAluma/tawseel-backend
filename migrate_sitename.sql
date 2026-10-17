-- للذين نفّذوا النسخة السابقة: شغّل هذا السطر فقط
alter table settings add column site_name text not null default 'توصيل فلسطين' check (char_length(site_name) between 1 and 40);
