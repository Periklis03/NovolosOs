-- Demo data taken from the prototype. Run AFTER the migration.
insert into skill_category (name, sort_order) values
 ('Languages',0),('Frameworks',1),('Databases',2),('Connectivity',3),('DevOps & Tools',4),('Ways of working',5);

insert into skill (category_id, name)
select c.id, v.skill from (values
 ('Languages','Java'),('Languages','Kotlin'),('Languages','Go'),('Languages','C++'),('Languages','Dart'),
 ('Languages','Python'),('Languages','JavaScript'),('Languages','TypeScript'),
 ('Frameworks','Spring Boot'),('Frameworks','Flutter'),('Frameworks','React'),('Frameworks','Next.js'),('Frameworks','Node.js'),
 ('Databases','PostgreSQL'),('Databases','MS SQL'),('Databases','MongoDB'),
 ('Connectivity','REST API'),('Connectivity','MQTT'),('Connectivity','gRPC'),('Connectivity','Kafka'),
 ('DevOps & Tools','Git'),('DevOps & Tools','Docker'),('DevOps & Tools','CI/CD'),('DevOps & Tools','Kubernetes'),
 ('DevOps & Tools','Linux'),('DevOps & Tools','AWS'),
 ('Ways of working','Agile/Scrum'),('Ways of working','Mentoring'),('Ways of working','Code review')
) as v(cat, skill) join skill_category c on c.name = v.cat;

insert into employee (full_name, role_title, seniority, years_experience, education) values
 ('Periklis Priftis','Software Engineer','junior',2,'BSc Computer Science, Aristotle University'),
 ('Eleni Vasiliou','Senior Backend Engineer','senior',6,'MSc Software Engineering, AUTH'),
 ('Maria Georgiou','Backend Engineer','mid',4,'BSc Computer Science, AUTH');

-- Eleni leads the other two (Phase-1 stand-in for team ownership)
update employee set lead_id = (select id from employee where full_name='Eleni Vasiliou')
 where full_name in ('Periklis Priftis','Maria Georgiou');

-- (employee, skill, self, validated)
insert into employee_skill (employee_id, skill_id, self_level, validated_level)
select e.id, s.id, v.self_l, v.val_l from (values
 ('Periklis Priftis','Java',3,3),('Periklis Priftis','Spring Boot',3,3),('Periklis Priftis','PostgreSQL',3,3),
 ('Periklis Priftis','Flutter',3,4),('Periklis Priftis','REST API',4,4),('Periklis Priftis','Docker',3,3),
 ('Eleni Vasiliou','Java',5,5),('Eleni Vasiliou','Kotlin',4,4),('Eleni Vasiliou','Spring Boot',5,5),
 ('Eleni Vasiliou','PostgreSQL',4,4),('Eleni Vasiliou','Kafka',4,4),('Eleni Vasiliou','Mentoring',4,4),
 ('Maria Georgiou','Java',4,4),('Maria Georgiou','Spring Boot',4,4),('Maria Georgiou','PostgreSQL',4,4),
 ('Maria Georgiou','MongoDB',3,3)
) as v(emp, skill, self_l, val_l)
join employee e on e.full_name = v.emp join skill s on s.name = v.skill;

-- After you sign up your first user in Supabase Auth, link + make them admin:
--   update employee set auth_user_id = '<your auth.users id>' where full_name = 'Periklis Priftis';
--   insert into app_role (employee_id, role)
--     select id, 'admin' from employee where full_name = 'Periklis Priftis';

-- Easier option (needs migration 0002): set your email on the employee row BEFORE
-- you create the user in Authentication, and the login links itself automatically:
--   update employee set email = 'you@example.com' where full_name = 'Periklis Priftis';
-- (then you only need the app_role insert above, using the same full_name lookup)
