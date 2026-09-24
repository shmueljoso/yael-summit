/**
 * Sample content so the network doesn't look empty while it's being shown and tested.
 * Controlled by the DEMO_DATA variable in wrangler.jsonc:
 *   "on"  → the sample principals, connections and posts exist, and every new member
 *           gets two sample connection requests and a welcome conversation.
 *   "off" → everything marked as sample is deleted. Real members are never touched.
 * Sample accounts can't sign in (they have no usable password).
 * All names, schools and posts here are fictional.
 */
import { locate } from "./places.js";
import { pairOf, pairKey } from "./db.js";

// [name, role, school, city, country, level, topics, gives, seeks, bio]
const P = [
  ["Rachel Levin", "Head of School", "Herzl Hebrew Day School", "London", "United Kingdom", "k12", ["hebrew", "identity", "enrollment"], ["hebrew", "studies"], ["security", "fundraising"], "Twenty years in Jewish education, the last eight leading Herzl. We're rethinking how Hebrew is taught from nursery to Year 11."],
  ["David Cohen", "Principal", "Beit Hatikvah Academy", "Toronto", "Canada", "k12", ["security", "wellbeing", "identity"], ["security", "wellbeing"], ["hebrew", "innovation"], "Former guidance counselor. I care most about kids feeling safe — physically and emotionally."],
  ["Miriam Goldberg", "Head of Lower School", "Kehilla Day School", "Boston", "United States", "elem", ["hebrew", "community"], ["community", "hebrew"], ["enrollment", "staff"], "Our parents' council runs half our Jewish holiday programming. Ask me how."],
  ["Ariel Katz", "Director", "Colegio Or Hadash", "Mexico City", "Mexico", "k12", ["innovation", "israel"], ["innovation", "israel"], ["hebrew", "identity"], "Engineer turned educator. We built a maker-space where every project connects to a Jewish value."],
  ["Sarah Blum", "Principal", "Neve Shalom School", "Budapest", "Hungary", "high", ["identity", "security", "fundraising"], ["fundraising"], ["security", "hebrew"], "Rebuilding Jewish identity in a community that lost two generations of it. Every family that walks in is a small miracle."],
  ["Yonatan Peretz", "Head of School", "Shoresh College", "Melbourne", "Australia", "k12", ["staff", "leadership", "hebrew"], ["leadership", "staff"], ["wellbeing", "israel"], "Leading a staff of 180. Obsessed with how good schools keep good teachers."],
  ["Anna Kaplan", "Principal", "Beit Ha'or School", "Kyiv", "Ukraine", "mid", ["wellbeing", "community"], ["wellbeing"], ["fundraising", "hebrew"], "We kept the school open through everything. Trauma-informed teaching is no longer a workshop topic for us."],
  ["Daniel Weiss", "Head of Jewish Studies", "Menorah High School", "Johannesburg", "South Africa", "high", ["studies", "israel", "identity"], ["studies", "israel"], ["innovation", "hebrew"], "Teaching Tanach to teenagers who ask hard questions — the best job there is."],
  ["Esther Rosenberg", "Head of School", "Nitzan Day School", "New York", "United States", "k12", ["enrollment", "fundraising", "leadership"], ["fundraising", "enrollment"], ["wellbeing", "studies"], "Tuition is the question every parent asks first. We've grown enrollment 30% in four years."],
  ["Yaakov Friedman", "Principal", "Talmud Torah Tiferet", "Antwerp", "Belgium", "elem", ["studies", "hebrew", "community"], ["studies"], ["innovation", "staff"], "Third-generation teacher in Antwerp. Our classrooms speak Yiddish, Dutch, Hebrew and French."],
  ["Claire Benhamou", "Directrice", "École Or Lumière", "Paris", "France", "k12", ["security", "identity", "wellbeing"], ["security"], ["wellbeing", "fundraising"], "Security guards at the gate, joy inside the walls. That balance is my whole job."],
  ["Lucas Szpigel", "Director General", "Escuela Hebrea Lamed", "Buenos Aires", "Argentina", "k12", ["identity", "israel", "community"], ["israel", "community"], ["enrollment", "innovation"], "Our graduates' trip to Israel is the heart of the school year. Happy to share how we fund it."],
  ["Rebecca Stein", "Head of School", "Shalom Academy", "Los Angeles", "United States", "elem", ["innovation", "wellbeing"], ["innovation"], ["hebrew", "security"], "Project-based learning, mindfulness, and a lot of Shabbat singing."],
  ["Mikhail Rabinovich", "Principal", "Etz Chaim Jewish School", "Moscow", "Russia", "k12", ["hebrew", "identity"], ["hebrew"], ["staff", "innovation"], "Most of our students' families rediscovered Judaism in the last 25 years. We teach the parents too."],
  ["Tamar Aviv", "Principal", "Hadassah Day School", "Sydney", "Australia", "elem", ["israel", "wellbeing", "staff"], ["israel"], ["enrollment", "leadership"], "Israeli-born, twelve years in Sydney. Our Hebrew immersion starts at age three."],
  ["Benjamin Halevi", "Head of School", "Maimon Community School", "Chicago", "United States", "k12", ["leadership", "fundraising", "staff"], ["leadership", "fundraising"], ["identity", "security"], "Board relations, capital campaigns, and still teaching one Gemara class a week."],
  ["Noa Shapiro", "Deputy Head", "Kochav Primary School", "Manchester", "United Kingdom", "elem", ["wellbeing", "community", "hebrew"], ["wellbeing", "community"], ["studies", "innovation"], "Pastoral lead. Our wellbeing curriculum is built around Jewish values like chesed and kavod."],
  ["Gabriel Mizrahi", "Diretor", "Colégio Nova Aliança", "São Paulo", "Brazil", "k12", ["innovation", "identity", "enrollment"], ["innovation", "enrollment"], ["hebrew", "staff"], "Brazil's Jewish community is young and energetic. So is our school."],
  ["Hannah Klein", "Schulleiterin", "Jüdisches Gymnasium Sternberg", "Berlin", "Germany", "high", ["identity", "security", "studies"], ["security", "identity"], ["hebrew", "enrollment"], "Half our students aren't Jewish. Teaching Judaism openly in Berlin is its own kind of statement."],
  ["Isaac Toledano", "Principal", "École Beth Yaakov Atlas", "Casablanca", "Morocco", "k12", ["community", "studies", "hebrew"], ["community", "studies"], ["innovation", "enrollment"], "A small, ancient community with a big heart. Our students know every family by name."],
  ["Leah Bernstein", "Head of School", "Gan Yeladim Day School", "Miami", "United States", "early", ["community", "enrollment"], ["enrollment", "community"], ["staff", "wellbeing"], "Early childhood is where families decide whether to stay in Jewish education. We work hard on those first years."],
  ["Ilan Grossman", "Head of School", "Aotearoa Jewish Academy", "Auckland", "New Zealand", "k12", ["identity", "community", "leadership"], ["leadership"], ["hebrew", "israel"], "The only Jewish day school in the country. Every decision is a community decision."],
  ["Dvora Mendel", "Principal", "Bnot Chaya High School", "Montreal", "Canada", "high", ["studies", "staff", "wellbeing"], ["studies", "staff"], ["innovation", "security"], "Bilingual school, trilingual students (English, French, Hebrew). Mentoring young teachers is my favorite part."],
  ["Paulina Wajnberg", "Principal", "Beit Yosef School", "Warsaw", "Poland", "k12", ["identity", "hebrew", "fundraising"], ["identity"], ["fundraising", "studies"], "A living Jewish school in Warsaw. That sentence still gives me goosebumps."],
  ["Oren Ben-Ami", "Director", "Colegio Hebreo Unión", "Santiago", "Chile", "k12", ["israel", "security", "community"], ["israel", "security"], ["wellbeing", "staff"], "We run a year-long Israel program that ends with our graduates teaching the younger grades."],
  ["Sophie Lévy", "Directrice", "Groupe Scolaire Aquarelle", "Strasbourg", "France", "elem", ["hebrew", "wellbeing"], ["hebrew"], ["security", "leadership"], "Small school, big ambitions. Our Hebrew reading program works for kids who struggle with reading in general."],
  ["Nathan Adler", "Head of School", "Emek Academy", "Philadelphia", "United States", "mid", ["innovation", "studies", "enrollment"], ["innovation", "studies"], ["fundraising", "hebrew"], "Middle school is where kids decide what Judaism means to them. We give them real questions, not easy answers."],
  ["Yelena Gurevich", "Principal", "Shalom School", "Dnipro", "Ukraine", "k12", ["wellbeing", "staff", "community"], ["wellbeing", "staff"], ["fundraising", "innovation"], "Our teachers carried this school on their backs. I want the world to know their names."],
  ["Eli Sasson", "Head of School", "Isthmus Hebrew Academy", "Panama City", "Panama", "k12", ["identity", "enrollment", "hebrew"], ["enrollment"], ["studies", "wellbeing"], "A close community, an ambitious school. Almost every Jewish child in the city is ours."],
  ["Judith Schwartz", "Head of School", "Beit Emunah School", "Vienna", "Austria", "k12", ["identity", "security", "studies"], ["studies"], ["innovation", "hebrew"], "A Jewish school in Vienna, open to every child who wants a Jewish education."],
  ["Aaron Fishman", "Principal", "Golden Gate Hebrew Academy", "San Francisco", "United States", "k12", ["innovation", "leadership"], ["innovation", "leadership"], ["identity", "israel"], "Silicon Valley parents expect tech. We teach them when to put it down."],
  ["Miriam Azulay", "Directora", "Colegio Estrella de David", "Caracas", "Venezuela", "k12", ["community", "wellbeing", "fundraising"], ["community"], ["fundraising", "enrollment"], "A shrinking community that refuses to shrink its dreams."],
  ["Shlomo Katzenelson", "Rosh Yeshiva", "Yeshivat Keter Torah", "Johannesburg", "South Africa", "high", ["studies", "leadership"], ["studies", "leadership"], ["wellbeing", "innovation"], "Torah learning with academic excellence. Our matric results speak for themselves."],
  ["Ruth Abramson", "Head of School", "Kinneret College", "Perth", "Australia", "elem", ["staff", "community"], ["staff"], ["hebrew", "enrollment"], "Far from everything, close to each other. Recruiting Jewish studies teachers to Perth is my constant challenge."],
  ["Marco Sonnino", "Preside", "Scuola Ebraica Or Tamid", "Rome", "Italy", "k12", ["identity", "studies", "hebrew"], ["identity", "studies"], ["innovation", "wellbeing"], "The oldest Jewish community in Europe, and a school that has to keep inventing itself."],
  ["Chana Weinberg", "Principal", "Shefa Learning Academy", "Baltimore", "United States", "elem", ["wellbeing", "studies"], ["wellbeing"], ["security", "enrollment"], "Special education inclusion is my passion. Every child can learn Torah."],
  ["Tomas Kraus", "Principal", "Beit Hadar School", "Prague", "Czech Republic", "elem", ["identity", "community"], ["community"], ["hebrew", "fundraising"], "Our students' great-grandparents' names are on the walls of the Pinkas Synagogue. They know it."],
  ["Deborah Nathan", "Head of School", "Shalom Primary School", "Dublin", "Ireland", "elem", ["enrollment", "identity"], ["identity"], ["enrollment", "fundraising"], "One of the smallest Jewish schools in Europe — and still here."],
  ["Ariel Pinto", "Director", "Escuela Hebrea Shalev", "Montevideo", "Uruguay", "k12", ["israel", "innovation", "hebrew"], ["israel", "hebrew"], ["security", "leadership"], "We teach Hebrew through music, theater and a lot of Uruguayan football."],
  ["Rivka Horowitz", "Head of Early Years", "Gan Keshet", "Riga", "Latvia", "early", ["community", "hebrew"], ["hebrew"], ["enrollment", "wellbeing"], "From a kindergarten of eight children to seventy in six years."],
];

// Pairs of indexes into P that are already connected.
const EDGES = [
  [0, 1], [0, 2], [0, 4], [0, 16], [0, 34], [1, 3], [1, 10], [1, 22], [2, 20], [2, 8], [2, 35], [3, 11], [3, 17], [3, 24], [3, 38],
  [4, 18], [4, 23], [4, 36], [5, 14], [5, 21], [5, 33], [6, 27], [6, 13], [6, 39], [7, 32], [7, 11], [8, 15], [8, 26], [8, 30],
  [9, 25], [9, 29], [10, 25], [10, 18], [11, 24], [11, 38], [12, 30], [12, 20], [13, 27], [14, 33], [15, 30], [16, 37], [17, 28],
  [18, 29], [19, 10], [19, 34], [21, 14], [22, 35], [23, 36], [24, 31], [26, 12], [28, 31], [29, 34], [32, 9], [35, 20], [36, 39], [37, 0],
];

// [author index, kind, text (English), original or null, lang, hours ago]
const POSTS = [
  [8, "question", "How are you keeping enrollment up when tuition keeps rising? We've tried sibling discounts and a community scholarship fund. What else has worked for you?", null, "en", 3],
  [3, "offer", "We built a maker-space program where every project is tied to a Jewish value (tikkun olam, bal tashchit, chesed). Happy to share the full curriculum with any school.", "Construimos un programa de maker-space donde cada proyecto se vincula con un valor judío (tikún olam, bal tashjit, jésed). Con gusto compartimos el currículo completo con cualquier escuela.", "es", 7],
  [0, "idea", "Idea: twin our schools. Hebrew pen pals for grades 4–6, and a joint Kabbalat Shabbat on Zoom once a term. Who's in?", null, "en", 12],
  [10, "question", "How do you talk with young children about the security guards at the gate without making them afraid?", "Comment parlez-vous aux jeunes enfants des agents de sécurité à l'entrée sans leur faire peur ?", "fr", 20],
  [6, "offer", "We have written a trauma-informed teaching guide for Jewish schools in crisis situations. Free for any school that needs it.", "Мы написали руководство по травма-информированному обучению для еврейских школ в кризисных ситуациях. Бесплатно для любой школы, которой оно нужно.", "ru", 26],
  [5, "question", "What is your best strategy for keeping excellent Jewish studies teachers for more than three years?", null, "en", 30],
  [14, "idea", "Shabbat at school every Friday with the parents: kiddush, singing and a short dvar Torah by a student. It changed our school's atmosphere.", "שבת בבית הספר כל יום שישי עם ההורים: קידוש, שירה ודבר תורה קצר של תלמיד. זה שינה את האווירה בבית הספר.", "he", 40],
  [17, "question", "Has anyone introduced AI tools into Jewish studies classes? We are looking for examples that really worked.", "Alguém já introduziu ferramentas de IA nas aulas de estudos judaicos? Estamos procurando exemplos que realmente funcionaram.", "pt", 52],
  [11, "offer", "Our graduates' Israel trip is funded by a 12-year savings plan families start in first grade. Happy to share the model and spreadsheets.", "El viaje a Israel de nuestros egresados se financia con un plan de ahorro de 12 años que las familias empiezan en primer grado. Con gusto compartimos el modelo.", "es", 60],
  [16, "idea", "We replaced our generic wellbeing curriculum with one built around middot: chesed, kavod, anavah. Students connect to it far more.", null, "en", 75],
  [18, "question", "Half of our students are not Jewish. How do other schools teach Jewish holidays and prayer to a mixed class respectfully?", "Die Hälfte unserer Schüler ist nicht jüdisch. Wie unterrichten andere Schulen jüdische Feiertage und Gebet respektvoll in einer gemischten Klasse?", "de", 90],
  [27, "offer", "Our teachers developed a program for continuing lessons during air-raid alerts, in the shelter. We will gladly share it with any school preparing for emergencies.", "Наші вчителі розробили програму продовження уроків під час повітряних тривог, в укритті. Охоче поділимося з будь-якою школою.", "uk", 110],
];

const HOUR = 3600e3;
const unusable = "demo-no-login";

const idOf = (i) => `demo${String(i).padStart(2, "0")}`;

export async function hasDemo(d) {
  return !!(await d.prepare("SELECT 1 FROM users WHERE is_demo = 1 LIMIT 1").first());
}

export async function seedDemo(d) {
  const now = Date.now();
  const stmts = [];
  P.forEach(([name, role, school, city, country, level, topics, gives, seeks, bio], i) => {
    const [lat, lng] = locate(city, country) || [null, null];
    stmts.push(d.prepare(
      `INSERT OR IGNORE INTO users (id, email, pass_hash, salt, full_name, role_title, school, city, country, level, bio, topics, gives, seeks, created_at, is_demo, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(idOf(i), `${idOf(i)}@sample.invalid`, unusable, unusable, name, role, school, city, country, level, bio,
      JSON.stringify(topics), JSON.stringify(gives), JSON.stringify(seeks), now - (P.length - i) * 5 * HOUR, lat, lng));
  });
  EDGES.forEach(([x, y], k) => {
    const [a, b] = pairOf(idOf(x), idOf(y));
    const t = now - (k + 1) * 3 * HOUR;
    stmts.push(d.prepare("INSERT OR IGNORE INTO connections (a, b, status, requested_by, note, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, '', ?, ?)").bind(a, b, idOf(x), t, t + HOUR));
  });
  POSTS.forEach(([who, kind, text, original, lang, h], k) => {
    stmts.push(d.prepare("INSERT OR IGNORE INTO posts (id, user_id, kind, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`demopost${k}`, idOf(who), kind, text, original, lang, now - h * HOUR));
  });
  await d.batch(stmts);
}

export async function removeDemo(d) {
  await d.batch([
    d.prepare("DELETE FROM messages WHERE from_id IN (SELECT id FROM users WHERE is_demo = 1) OR to_id IN (SELECT id FROM users WHERE is_demo = 1)"),
    d.prepare("DELETE FROM connections WHERE a IN (SELECT id FROM users WHERE is_demo = 1) OR b IN (SELECT id FROM users WHERE is_demo = 1)"),
    d.prepare("DELETE FROM posts WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)"),
    d.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)"),
    d.prepare("DELETE FROM users WHERE is_demo = 1"),
  ]);
}

/**
 * Gives a new member something to see right away: two requests with notes,
 * and one accepted connection that has already said hello.
 */
export async function welcomeDemo(d, userId) {
  const now = Date.now();
  const reqs = [
    [4, "Shalom! I saw you joined. We're working on Jewish identity with families who are just reconnecting. Would love to compare notes before the summit."],
    [11, "Hi! We'd be happy to share how we fund our graduates' Israel trip. Let's connect."],
  ];
  const friend = 0;
  const stmts = reqs.map(([i, note], k) => {
    const [a, b] = pairOf(idOf(i), userId);
    return d.prepare("INSERT OR IGNORE INTO connections (a, b, status, requested_by, note, created_at) VALUES (?, ?, 'pending', ?, ?, ?)").bind(a, b, idOf(i), note, now - (k + 1) * 60e3);
  });
  const [a, b] = pairOf(idOf(friend), userId);
  stmts.push(d.prepare("INSERT OR IGNORE INTO connections (a, b, status, requested_by, note, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, '', ?, ?)").bind(a, b, idOf(friend), now - 5 * 60e3, now - 4 * 60e3));
  const pair = pairKey(idOf(friend), userId);
  stmts.push(d.prepare("INSERT INTO messages (pair, from_id, to_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(pair, idOf(friend), userId,
    "Shalom and welcome to the constellation! I'm Rachel, head of Herzl in London. Take a look at the suggestions on your home page — and if Hebrew or Jewish studies are on your mind this year, I'm happy to talk anytime.", now - 3 * 60e3));
  await d.batch(stmts);
}
