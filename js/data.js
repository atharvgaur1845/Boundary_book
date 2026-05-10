/* Boundary Book — static reference data
   IPL teams + indicative squads + bet config + payout schedules.
   Squads are editable; the app falls back to free text where players differ. */

const IPL_TEAMS = {
  CSK: { name: "Chennai Super Kings",     code: "CSK", color: "#fdb913", text: "#0a1628", short: "Chennai"   },
  MI:  { name: "Mumbai Indians",          code: "MI",  color: "#004ba0", text: "#ffffff", short: "Mumbai"    },
  RCB: { name: "Royal Challengers Bengaluru", code: "RCB", color: "#cf2920", text: "#ffffff", short: "Bengaluru" },
  KKR: { name: "Kolkata Knight Riders",   code: "KKR", color: "#3a225d", text: "#f4ecd8", short: "Kolkata"   },
  SRH: { name: "Sunrisers Hyderabad",     code: "SRH", color: "#fb6413", text: "#0a1628", short: "Hyderabad" },
  DC:  { name: "Delhi Capitals",          code: "DC",  color: "#17449b", text: "#ffffff", short: "Delhi"     },
  RR:  { name: "Rajasthan Royals",        code: "RR",  color: "#e93397", text: "#ffffff", short: "Rajasthan" },
  PBKS:{ name: "Punjab Kings",            code: "PBKS",color: "#a71930", text: "#ffffff", short: "Punjab"    },
  GT:  { name: "Gujarat Titans",          code: "GT",  color: "#1c2c52", text: "#f4ecd8", short: "Gujarat"   },
  LSG: { name: "Lucknow Super Giants",    code: "LSG", color: "#0d4ea2", text: "#ffffff", short: "Lucknow"   }
};

/* Indicative squads — used for player-pick dropdowns. Pre-populated with marquee
   names; users may type anyone via the "Custom" option. */
const SQUADS = {
  CSK: ["MS Dhoni","Ruturaj Gaikwad","Ravindra Jadeja","Shivam Dube","Matheesha Pathirana","Devon Conway","Tushar Deshpande","Mustafizur Rahman","Ajinkya Rahane","Daryl Mitchell","Moeen Ali","Deepak Chahar"],
  MI:  ["Rohit Sharma","Hardik Pandya","Suryakumar Yadav","Jasprit Bumrah","Ishan Kishan","Tim David","Tilak Varma","Piyush Chawla","Gerald Coetzee","Nehal Wadhera","Akash Madhwal","Romario Shepherd"],
  RCB: ["Virat Kohli","Faf du Plessis","Glenn Maxwell","Mohammed Siraj","Dinesh Karthik","Cameron Green","Rajat Patidar","Anuj Rawat","Karn Sharma","Yash Dayal","Mahipal Lomror","Will Jacks"],
  KKR: ["Shreyas Iyer","Andre Russell","Sunil Narine","Venkatesh Iyer","Rinku Singh","Mitchell Starc","Varun Chakaravarthy","Phil Salt","Nitish Rana","Harshit Rana","Ramandeep Singh","Anukul Roy"],
  SRH: ["Pat Cummins","Aiden Markram","Heinrich Klaasen","Travis Head","Abhishek Sharma","Bhuvneshwar Kumar","T Natarajan","Rahul Tripathi","Mayank Agarwal","Washington Sundar","Abdul Samad","Nitish Reddy"],
  DC:  ["Rishabh Pant","David Warner","Axar Patel","Mitchell Marsh","Anrich Nortje","Kuldeep Yadav","Prithvi Shaw","Ricky Bhui","Tristan Stubbs","Mukesh Kumar","Khaleel Ahmed","Abishek Porel"],
  RR:  ["Sanju Samson","Jos Buttler","Yashasvi Jaiswal","Trent Boult","Ravichandran Ashwin","Shimron Hetmyer","Yuzvendra Chahal","Riyan Parag","Dhruv Jurel","Avesh Khan","Sandeep Sharma","Rovman Powell"],
  PBKS:["Shikhar Dhawan","Liam Livingstone","Sam Curran","Kagiso Rabada","Arshdeep Singh","Jonny Bairstow","Jitesh Sharma","Harpreet Brar","Rahul Chahar","Atharva Taide","Prabhsimran Singh","Rishi Dhawan"],
  GT:  ["Shubman Gill","Rashid Khan","Mohammed Shami","David Miller","Wriddhiman Saha","Kane Williamson","Sai Sudharsan","Mohit Sharma","Noor Ahmad","Vijay Shankar","Rahul Tewatia","Abhinav Manohar"],
  LSG: ["KL Rahul","Nicholas Pooran","Quinton de Kock","Marcus Stoinis","Ravi Bishnoi","Mark Wood","Naveen-ul-Haq","Krunal Pandya","Mayank Yadav","Deepak Hooda","Yash Thakur","Ayush Badoni"]
};

/* Bet specs. Each carries scoring weight and answering style.
   kind:
     - team:    pick one of the two playing teams
     - player:  pick one player (squad dropdown + free text)
     - range:   pick a numeric bucket
*/
const BET_TYPES = [
  { key: "toss",     label: "Toss Winner",            points: 5,  kind: "team",   helper: "Who wins the coin toss." },
  { key: "winner",   label: "Match Winner",           points: 12, kind: "team",   helper: "Who lifts the points tonight." },
  { key: "potm",     label: "Player of the Match",    points: 20, kind: "player", helper: "The brightest light of the evening." },
  { key: "topRun",   label: "Top Run-Scorer",         points: 15, kind: "player", helper: "Highest individual batting score." },
  { key: "topWicket",label: "Top Wicket-Taker",       points: 15, kind: "player", helper: "Most wickets across both innings." },
  { key: "captain",  label: "Captain Outscores",      points: 8,  kind: "team",   helper: "Whose captain has the better game." },
  { key: "fours",    label: "Total 4s in Match",      points: 8,  kind: "range",
    buckets: [
      { id: "f1", label: "≤ 25",   min: 0,  max: 25 },
      { id: "f2", label: "26 – 35", min: 26, max: 35 },
      { id: "f3", label: "36 – 45", min: 36, max: 45 },
      { id: "f4", label: "46 +",   min: 46, max: 999 }
    ],
    helper: "Aggregate boundaries across both innings." },
  { key: "sixes",    label: "Total 6s in Match",      points: 8,  kind: "range",
    buckets: [
      { id: "s1", label: "≤ 8",    min: 0,  max: 8  },
      { id: "s2", label: "9 – 14", min: 9,  max: 14 },
      { id: "s3", label: "15 – 20",min: 15, max: 20 },
      { id: "s4", label: "21 +",   min: 21, max: 999 }
    ],
    helper: "Aggregate maximums across both innings." },
  { key: "topScore", label: "Highest Individual Score",points: 8, kind: "range",
    buckets: [
      { id: "t1", label: "< 50",      min: 0,   max: 49  },
      { id: "t2", label: "50 – 79",   min: 50,  max: 79  },
      { id: "t3", label: "80 – 99",   min: 80,  max: 99  },
      { id: "t4", label: "100 +",     min: 100, max: 999 }
    ],
    helper: "Best knock by any single batter." }
];

/* Payout schedule by contest size — % of pool to each rank.
   Modelled on Dream11 mid-tier contests: only top fraction wins. */
const PAYOUT_SCHEDULES = {
  3:  [0.60, 0.40],
  5:  [0.50, 0.30, 0.20],
  10: [0.40, 0.25, 0.18, 0.10, 0.07]
};

/* Default contest tiers presented when joining a match. */
const CONTEST_TIERS = [
  { entry: 50,  size: 3,  label: "Friendly Three" },
  { entry: 100, size: 5,  label: "The Quintet" },
  { entry: 250, size: 10, label: "Pavilion League" },
  { entry: 500, size: 5,  label: "Members' Box" }
];

/* Bot persona names — for simulated opponents. */
const BOT_NAMES = [
  "Lord Ashcombe","Major Whitfield","Mr. Pendleton","Sir Rowland","Capt. Beaumont",
  "Dr. Faraday","Mrs. Hartwell","Lady Carstairs","Col. Forrester","Prof. Linwood",
  "Old Tom","Young Pip","The Vicar","The Bookmaker","The Scribe"
];
