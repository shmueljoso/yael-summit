/* Sample data — names and schools are fictional. The live version fills this from registration. */
window.SUMMIT = {
  topics: [
    { id: "climate",    label: "School climate & safety", color: "#2F7BF5" },
    { id: "inclusion",  label: "Inclusion",               color: "#E0678F" },
    { id: "ai",         label: "AI & technology",         color: "#6A5CF0" },
    { id: "staff",      label: "Teacher resilience",      color: "#F2994A" },
    { id: "parents",    label: "Parents & community",     color: "#14B8A6" },
    { id: "wellbeing",  label: "Student wellbeing",       color: "#EC6BB0" },
    { id: "gaps",       label: "Closing learning gaps",   color: "#1FA3F2" },
    { id: "innovation", label: "Pedagogical innovation",  color: "#8B5CF6" },
    { id: "leadership", label: "Leadership",              color: "#0D1B4A" }
  ],
  levels: { elem: "Elementary", mid: "Middle school", high: "High school", six: "6-year school" },
  regions: { north: "North", haifa: "Haifa area", center: "Center", jlm: "Jerusalem area", south: "South" },
  people: [
    { id: 1,  name: "Ronit Cohen",       school: "HaDekel Elementary",      city: "Be'er Sheva",    region: "south",  level: "elem", topics: ["climate","parents","gaps"],          gives: ["parents","climate"],       seeks: ["ai","staff"] },
    { id: 2,  name: "Avi Levi",          school: "Science & Arts High",     city: "Haifa",          region: "haifa",  level: "high", topics: ["ai","innovation","staff"],          gives: ["ai","innovation"],         seeks: ["wellbeing","parents"] },
    { id: 3,  name: "Samah Khoury",      school: "Al-Nour Middle School",   city: "Nazareth",       region: "north",  level: "mid",  topics: ["gaps","parents","leadership"],      gives: ["parents","gaps"],          seeks: ["innovation","ai"] },
    { id: 4,  name: "Dana Friedman",     school: "Shaked Elementary",       city: "Ra'anana",       region: "center", level: "elem", topics: ["inclusion","wellbeing","staff"],     gives: ["inclusion","wellbeing"],   seeks: ["leadership","climate"] },
    { id: 5,  name: "Yossi Mizrahi",     school: "Ramot 6-Year School",     city: "Jerusalem",      region: "jlm",    level: "six",  topics: ["leadership","staff","climate"],     gives: ["leadership","staff"],      seeks: ["ai","inclusion"] },
    { id: 6,  name: "Merav Stern",       school: "HaGalil Middle School",   city: "Karmiel",        region: "north",  level: "mid",  topics: ["wellbeing","climate","inclusion"],  gives: ["wellbeing","climate"],     seeks: ["gaps","parents"] },
    { id: 7,  name: "Omer Ben David",    school: "Ofek High School",        city: "Ashdod",         region: "south",  level: "high", topics: ["gaps","innovation","ai"],           gives: ["gaps","innovation"],       seeks: ["staff","leadership"] },
    { id: 8,  name: "Liat Golan",        school: "HaGefen Elementary",      city: "Modi'in",        region: "center", level: "elem", topics: ["innovation","parents","ai"],        gives: ["innovation","ai"],         seeks: ["inclusion","wellbeing"] },
    { id: 9,  name: "Khaled Abbas",      school: "Al-Farabi High School",   city: "Tayibe",         region: "center", level: "high", topics: ["leadership","gaps","staff"],        gives: ["gaps","leadership"],       seeks: ["ai","climate"] },
    { id: 10, name: "Naama Rosen",       school: "HaRimon Middle School",   city: "Tel Aviv",       region: "center", level: "mid",  topics: ["wellbeing","ai","climate"],         gives: ["wellbeing","ai"],          seeks: ["parents","leadership"] },
    { id: 11, name: "Moshe Azoulay",     school: "Neve Yam Elementary",     city: "Kiryat Yam",     region: "haifa",  level: "elem", topics: ["parents","gaps","climate"],         gives: ["parents","climate"],       seeks: ["innovation","staff"] },
    { id: 12, name: "Shira Birnbaum",    school: "Judean Hills High",       city: "Beit Shemesh",   region: "jlm",    level: "high", topics: ["inclusion","wellbeing","leadership"], gives: ["inclusion","leadership"], seeks: ["ai","gaps"] },
    { id: 13, name: "Galit Ohayon",      school: "Kalanit Elementary",      city: "Dimona",         region: "south",  level: "elem", topics: ["gaps","staff","wellbeing"],         gives: ["staff","gaps"],            seeks: ["innovation","parents"] },
    { id: 14, name: "Itai Shapira",      school: "Negev 6-Year School",     city: "Yeruham",        region: "south",  level: "six",  topics: ["innovation","leadership","parents"], gives: ["innovation","parents"],  seeks: ["wellbeing","inclusion"] },
    { id: 15, name: "Rina Tal",          school: "HaCarmel Middle School",  city: "Haifa",          region: "haifa",  level: "mid",  topics: ["staff","climate","inclusion"],      gives: ["staff","inclusion"],       seeks: ["ai","gaps"] },
    { id: 16, name: "Alex Vogel",        school: "Amal Tech High",          city: "Holon",          region: "center", level: "high", topics: ["ai","gaps","innovation"],           gives: ["ai","gaps"],               seeks: ["climate","wellbeing"] },
    { id: 17, name: "Hadas Nahum",       school: "Alon Elementary",         city: "Afula",          region: "north",  level: "elem", topics: ["parents","inclusion","wellbeing"],  gives: ["parents","wellbeing"],     seeks: ["leadership","ai"] },
    { id: 18, name: "Yaakov Klein",      school: "Jerusalem Middle School", city: "Jerusalem",      region: "jlm",    level: "mid",  topics: ["climate","leadership","gaps"],      gives: ["climate","leadership"],    seeks: ["innovation","staff"] },
    { id: 19, name: "Inbal Dahan",       school: "Sharon 6-Year School",    city: "Netanya",        region: "center", level: "six",  topics: ["staff","wellbeing","innovation"],   gives: ["staff","wellbeing"],       seeks: ["parents","gaps"] },
    { id: 20, name: "Muhammad Said",     school: "Al-Salam Elementary",     city: "Rahat",          region: "south",  level: "elem", topics: ["gaps","parents","ai"],              gives: ["parents","gaps"],          seeks: ["ai","leadership"] },
    { id: 21, name: "Tamar Almog",       school: "HaEmek High School",      city: "Yokneam",        region: "north",  level: "high", topics: ["innovation","climate","staff"],     gives: ["innovation","climate"],    seeks: ["inclusion","parents"] },
    { id: 22, name: "Boaz Harari",       school: "Mevaseret Middle School", city: "Mevaseret Zion", region: "jlm",    level: "mid",  topics: ["ai","staff","leadership"],          gives: ["ai","staff"],              seeks: ["wellbeing","climate"] },
    { id: 23, name: "Orly Biton",        school: "HaShachar Elementary",    city: "Kiryat Gat",     region: "south",  level: "elem", topics: ["wellbeing","inclusion","gaps"],     gives: ["inclusion","gaps"],        seeks: ["staff","ai"] },
    { id: 24, name: "Roi Barak",         school: "HaYam High School",       city: "Herzliya",       region: "center", level: "high", topics: ["leadership","innovation","parents"], gives: ["leadership","innovation"], seeks: ["gaps","inclusion"] },
    { id: 25, name: "Pnina Vaknin",      school: "Safed 6-Year School",     city: "Safed",          region: "north",  level: "six",  topics: ["climate","gaps","parents"],         gives: ["climate","gaps"],          seeks: ["ai","innovation"] },
    { id: 26, name: "Jenny Abramov",     school: "Nof Middle School",       city: "Ashkelon",       region: "south",  level: "mid",  topics: ["parents","wellbeing","staff"],      gives: ["parents","wellbeing"],     seeks: ["climate","leadership"] },
    { id: 27, name: "Adi Shalom",        school: "Tamar Elementary",        city: "Kfar Saba",      region: "center", level: "elem", topics: ["ai","inclusion","innovation"],      gives: ["ai","inclusion"],          seeks: ["parents","gaps"] },
    { id: 28, name: "Ziva Mansour",      school: "Carmel High School",      city: "Isfiya",         region: "haifa",  level: "high", topics: ["gaps","leadership","wellbeing"],    gives: ["leadership","wellbeing"],  seeks: ["ai","staff"] }
  ],
  /* Example board posts, shown until the live board has its own. */
  posts: [
    { id: "s1", kind: "question", name: "Galit Ohayon", school: "Kalanit Elementary", lang: "he",
      text: "How do you keep new teachers from burning out in their first year? We lost three this year and I'd love to hear what actually worked for you.",
      original: "איך אתם שומרים על מורים חדשים שלא יישחקו בשנה הראשונה? איבדנו השנה שלושה, ואשמח לשמוע מה באמת עבד אצלכם." },
    { id: "s2", kind: "offer", name: "Alex Vogel", school: "Amal Tech High", lang: "en",
      text: "Happy to share the AI lesson-planning workflow our staff built this year — it saves each teacher about two hours a week. Message me." },
    { id: "s3", kind: "idea", name: "Samah Khoury", school: "Al-Nour Middle School", lang: "ar",
      text: "We started a monthly parents' coffee morning run in both Arabic and Hebrew. Attendance tripled. Worth trying if your parent community is bilingual.",
      original: "بدأنا صباح قهوة شهري للأهالي باللغتين العربية والعبرية. تضاعف الحضور ثلاث مرات. يستحق التجربة إذا كان مجتمع الأهالي لديكم ثنائي اللغة." }
  ]
};
