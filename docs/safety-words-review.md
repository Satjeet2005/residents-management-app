# Safety words: list for review

**These lists are NOT yet verified by a native speaker.** The Hindi and Marathi words and phrases below were written by the agent that built the
classifier, from general knowledge of the languages, to catch a fire, a gas leak, a person stuck in a lift, an electric shock and (a fifth category added by a human, D153) a medical emergency or violence when a resident
writes in Hindi, Marathi, or Hindi or Marathi typed in Latin letters. They may contain wrong spellings, words that do not mean what the English
column says, missing common phrases, and words that are too general (a false alarm costs a phone call; a missed fire costs far more, so the
rules are written to catch too much rather than too little: see `docs/complaint-classification.md`).

The transliteration column was made by a simple program and is only a help to read the script; it is not a standard scheme and some
spellings are rough. The English meaning is per rule. English rules are not listed here (they are in `src/domain/complaints/safety.ts`).

## Changes since the first version (T10c, D169): the bare "current" rules are now more specific

**No word was added or removed.** Ten terms of five rules, all of them the bare electricity "current" (the word a resident also writes for a
bill, a power cut or "current gaya"), now count only when the SAME text also holds one of the shock words below. They are marked in the tables
further down. A native speaker is asked to check those rows and the shock-word list.

Before: these terms were always a hit. After: a hit only with a shock word.

- `SHOCK_HI_KARANT`: करंट, करेंट, करंट आ रहा
- `SHOCK_HI_LAG`: बिजली का करंट, करंट आ
- `SHOCK_MR_KARANT`: करंट, करंट आला
- `SHOCK_HI_LATN_CURRENT`: current aa raha, current aata
- `SHOCK_HI_LATN_JHATKA`: bijli ka current

Every other term is unchanged, including the terms that already name the shock (`करंट लगा`, `करंट लागला`, `current laga`, `current lagta`,
`current maar`, `बिजली लग`, `दीवार में करंट`, `नल में करंट`, `पानी में करंट`, and all English, lift, fire, gas and medical terms).

The shock words (`SHOCK_CONTEXT`, `src/domain/complaints/safety.ts`), whole words only: laga, lagla, laagla, lage, lagta, shock, shocks, jhatka,
jhatke, zatka, dhakka, dhakke, basla, touched, touching, electrocuted, chhune, chhoone; लगा, लागला, झटका, झटके, धक्का, धक्के, स्पर्श, शॉक, छूने,
छूते, छुआ. The words of the brief are laga, lagla, lage, lagta, shock, jhatka, jhatke, dhakka, basla, zatka, touched, touching, electrocuted and
लगा, लागला, झटका, धक्का, स्पर्श, शॉक. The plural and spelling forms (shocks, laagla, dhakke, झटके, धक्के) and the touch forms (छूने, छूते, छुआ,
chhune, chhoone) were added so that the existing test sentence "नल छूने पर करंट आता है" is still a hit.

What this costs: a resident who writes only "तार में करंट आ रहा है" or "current aa raha hai" with no shock word is no longer caught by these
terms (a "दीवार में करंट", "नल में करंट" or "पानी में करंट" still is). That is the price of not sending every "करंट नहीं है" to the duty manager as CRITICAL.

## How to read a row

- **Rule id**: the id in `SAFETY_RULES` (`src/domain/complaints/safety.ts`). One rule has several words and phrases, one row each.
- **A Devanagari word is a stem**: it also matches the same word with more letters after it (an ending), as long as it starts a word. So
  `अडकल` covers `अडकली`, `अडकलो` and `अडकले`. A space inside a phrase also matches no space (`लिफ्टमध्ये` and `लिफ्ट मध्ये`).
- **A Latin word must stand alone**: `aag` does not match `aagaman`.
- The text is first made plain: nukta marks removed and chandrabindu made anusvara, so `फँस` and `फंस` are the same.

## What to check, for each row

1. Is the spelling one a resident would really write? Add a missing common spelling.
2. Does it mean what the English column says, in that language?
3. Could it be an ordinary word in a message that is NOT an incident (for example `करंट` also means the electricity "current" on a bill)?
   That is acceptable if it is common in real incidents; say so, or ask for the rule to be narrowed. (The bare "current" terms were narrowed in
   T10c: see "Changes since the first version" below.)
4. Which common phrases are missing for the five categories: fire, gas, someone stuck in a lift, electric shock, medical emergency or violence?

Write your name and the date in the last column, and your corrections under the table or in a note to the developers.

## Rules

### FIRE

| Rule id | Language | Script text (as typed) | Transliteration (machine, approximate) | English meaning | Reviewed by / date |
|---|---|---|---|---|---|
| `FIRE_HI_AAG` | hi | आग | aag | fire (the word itself; 'आगे' (ahead) and similar words are excluded) | |
| `FIRE_HI_AAG_LAGI` | hi | आग लगी | aag lagee | fire has started / caught fire; arson | |
| `FIRE_HI_AAG_LAGI` | hi | आग लग | aag lag | fire has started / caught fire; arson | |
| `FIRE_HI_AAG_LAGI` | hi | आग लगा | aag lagaa | fire has started / caught fire; arson | |
| `FIRE_HI_AAG_LAGI` | hi | आग लगने | aag lagane | fire has started / caught fire; arson | |
| `FIRE_HI_AAG_LAGI` | hi | आगजनी | aagajanee | fire has started / caught fire; arson | |
| `FIRE_HI_AAG_LAGI` | hi | आग भड़क | aag bhadak | fire has started / caught fire; arson | |
| `FIRE_HI_DHUAN` | hi | धुआं | dhuaan | smoke | |
| `FIRE_HI_DHUAN` | hi | धुआ | dhuaa | smoke | |
| `FIRE_HI_DHUAN` | hi | धुंआ | dhunaa | smoke | |
| `FIRE_HI_DHUAN` | hi | धुएं | dhuen | smoke | |
| `FIRE_HI_DHUAN` | hi | धुँआ | dhunaa | smoke | |
| `FIRE_HI_JAL` | hi | जल रहा | jal rahaa | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जल रही | jal rahee | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जल रहे | jal rahe | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जल गया | jal gayaa | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जल गई | jal gaee | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जल गयी | jal gayee | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जलने | jalane | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जलता | jalataa | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जलती | jalatee | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_JAL` | hi | जलकर | jalakar | is burning / has burnt (not 'जल' alone, which also means water) | |
| `FIRE_HI_AGNI` | hi | अग्नि | agni | fire (formal), fire brigade, 'fire' written in Devanagari, flame | |
| `FIRE_HI_AGNI` | hi | दमकल | damakal | fire (formal), fire brigade, 'fire' written in Devanagari, flame | |
| `FIRE_HI_AGNI` | hi | फायर | phaayar | fire (formal), fire brigade, 'fire' written in Devanagari, flame | |
| `FIRE_HI_AGNI` | hi | फाइयर | phaaiyar | fire (formal), fire brigade, 'fire' written in Devanagari, flame | |
| `FIRE_HI_AGNI` | hi | लपट | lapat | fire (formal), fire brigade, 'fire' written in Devanagari, flame | |
| `FIRE_HI_SPARK` | hi | चिंगारी | chingaaree | spark, short circuit, wire burning | |
| `FIRE_HI_SPARK` | hi | शॉर्ट सर्किट | short sarkit | spark, short circuit, wire burning | |
| `FIRE_HI_SPARK` | hi | शार्ट सर्किट | shaart sarkit | spark, short circuit, wire burning | |
| `FIRE_HI_SPARK` | hi | स्पार्क | spaark | spark, short circuit, wire burning | |
| `FIRE_HI_SPARK` | hi | तार जल | taar jal | spark, short circuit, wire burning | |
| `FIRE_MR_AAGI` | mr | आगी | aagee | fire, in Marathi inflections (of fire, in the fire); fire has caught | |
| `FIRE_MR_AAGI` | mr | आगीचा | aageechaa | fire, in Marathi inflections (of fire, in the fire); fire has caught | |
| `FIRE_MR_AAGI` | mr | आगीत | aageet | fire, in Marathi inflections (of fire, in the fire); fire has caught | |
| `FIRE_MR_AAGI` | mr | आग लाग | aag laag | fire, in Marathi inflections (of fire, in the fire); fire has caught | |
| `FIRE_MR_AAGI` | mr | आगलाग | aagalaag | fire, in Marathi inflections (of fire, in the fire); fire has caught | |
| `FIRE_MR_DHUR` | mr | धूर | dhoor | smoke (not 'धुरळा', which is dust) | |
| `FIRE_MR_DHUR` | mr | धुर | dhur | smoke (not 'धुरळा', which is dust) | |
| `FIRE_MR_JALAT` | mr | जळत | jalat | burning, burnt, scorched | |
| `FIRE_MR_JALAT` | mr | जळाल | jalaal | burning, burnt, scorched | |
| `FIRE_MR_JALAT` | mr | जळून | jaloon | burning, burnt, scorched | |
| `FIRE_MR_JALAT` | mr | जळा | jalaa | burning, burnt, scorched | |
| `FIRE_MR_JALAT` | mr | होरपळ | horapal | burning, burnt, scorched | |
| `FIRE_MR_AGNI` | mr | अग्निशमन | agnishaman | fire brigade, fire (formal), fire engine | |
| `FIRE_MR_AGNI` | mr | अग्नी | agnee | fire brigade, fire (formal), fire engine | |
| `FIRE_MR_AGNI` | mr | आगीचा बंब | aageechaa bnb | fire brigade, fire (formal), fire engine | |
| `FIRE_MR_AGNI` | mr | फायर | phaayar | fire brigade, fire (formal), fire engine | |
| `FIRE_HI_LATN_AAG` | hi-Latn | aag | aag | aag = fire, typed in Latin letters | |
| `FIRE_HI_LATN_AAG` | hi-Latn | aaag | aaag | aag = fire, typed in Latin letters | |
| `FIRE_HI_LATN_AAG` | hi-Latn | aagg | aagg | aag = fire, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag lagi | aag lagi | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag lag gayi | aag lag gayi | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag lag gai | aag lag gai | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag laga | aag laga | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag laga hai | aag laga hai | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag lagne | aag lagne | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_PHRASE` | hi-Latn | aag lag rahi | aag lag rahi | fire has started, typed in Latin letters | |
| `FIRE_HI_LATN_DHUAN` | hi-Latn | dhuan | dhuan | smoke, typed in Latin letters | |
| `FIRE_HI_LATN_DHUAN` | hi-Latn | dhuaan | dhuaan | smoke, typed in Latin letters | |
| `FIRE_HI_LATN_DHUAN` | hi-Latn | dhuvan | dhuvan | smoke, typed in Latin letters | |
| `FIRE_HI_LATN_DHUAN` | hi-Latn | dhooan | dhooan | smoke, typed in Latin letters | |
| `FIRE_HI_LATN_DHUAN` | hi-Latn | dhuwan | dhuwan | smoke, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jal raha | jal raha | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jal rahi | jal rahi | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jal gaya | jal gaya | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jal gayi | jal gayi | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jalne | jalne | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jalti | jalti | is burning / burnt, typed in Latin letters | |
| `FIRE_HI_LATN_JAL` | hi-Latn | jalta | jalta | is burning / burnt, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aag lagli | aag lagli | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aag laagli | aag laagli | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aagi | aagi | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aagicha | aagicha | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aagit | aagit | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aagila | aagila | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_AAG` | mr-Latn | aag lagle | aag lagle | fire, Marathi, typed in Latin letters | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | dhur | dhur | smoke, Marathi, typed in Latin letters; 'is burning' | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | dhoor | dhoor | smoke, Marathi, typed in Latin letters; 'is burning' | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | dhurachya | dhurachya | smoke, Marathi, typed in Latin letters; 'is burning' | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | dhurala | dhurala | smoke, Marathi, typed in Latin letters; 'is burning' | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | jalat aahe | jalat aahe | smoke, Marathi, typed in Latin letters; 'is burning' | |
| `FIRE_MR_LATN_DHUR` | mr-Latn | jalat ahe | jalat ahe | smoke, Marathi, typed in Latin letters; 'is burning' | |

### GAS

| Rule id | Language | Script text (as typed) | Transliteration (machine, approximate) | English meaning | Reviewed by / date |
|---|---|---|---|---|---|
| `GAS_HI_WORD` | hi | गैस | gais | gas (the word itself, any use) | |
| `GAS_HI_WORD` | hi | गेस | ges | gas (the word itself, any use) | |
| `GAS_HI_WORD` | hi | गैस् | gais | gas (the word itself, any use) | |
| `GAS_HI_LEAK` | hi | गैस लीक | gais leek | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस रिसाव | gais risaav | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस का रिसाव | gais kaa risaav | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस निकल | gais nikal | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस रिस | gais ris | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस का लीकेज | gais kaa leekej | gas leak, gas is leaking out | |
| `GAS_HI_LEAK` | hi | गैस लिकेज | gais likej | gas leak, gas is leaking out | |
| `GAS_HI_SMELL` | hi | गैस की बदबू | gais kee badaboo | smell of gas | |
| `GAS_HI_SMELL` | hi | गैस की गंध | gais kee gndh | smell of gas | |
| `GAS_HI_SMELL` | hi | गैस की महक | gais kee mahak | smell of gas | |
| `GAS_HI_SMELL` | hi | गैस की स्मेल | gais kee smel | smell of gas | |
| `GAS_HI_SMELL` | hi | गैस की बू | gais kee boo | smell of gas | |
| `GAS_HI_SMELL` | hi | गैस जैसी बदबू | gais jaisee badaboo | smell of gas | |
| `GAS_HI_CYLINDER` | hi | सिलेंडर | silendar | cylinder, LPG, piped gas, cylinder burst | |
| `GAS_HI_CYLINDER` | hi | सिलिंडर | silindar | cylinder, LPG, piped gas, cylinder burst | |
| `GAS_HI_CYLINDER` | hi | एलपीजी | elapeejee | cylinder, LPG, piped gas, cylinder burst | |
| `GAS_HI_CYLINDER` | hi | पीएनजी | peeenajee | cylinder, LPG, piped gas, cylinder burst | |
| `GAS_HI_CYLINDER` | hi | सिलेंडर फट | silendar phat | cylinder, LPG, piped gas, cylinder burst | |
| `GAS_MR_WORD` | mr | गॅस | ges | gas (Marathi spelling), with Marathi endings | |
| `GAS_MR_WORD` | mr | गॅसचा | gesachaa | gas (Marathi spelling), with Marathi endings | |
| `GAS_MR_WORD` | mr | गॅसची | gesachee | gas (Marathi spelling), with Marathi endings | |
| `GAS_MR_WORD` | mr | गॅसचे | gesache | gas (Marathi spelling), with Marathi endings | |
| `GAS_MR_WORD` | mr | गॅसला | gesalaa | gas (Marathi spelling), with Marathi endings | |
| `GAS_MR_LEAK` | mr | गॅस गळती | ges galatee | gas leak | |
| `GAS_MR_LEAK` | mr | गॅस लीक | ges leek | gas leak | |
| `GAS_MR_LEAK` | mr | गॅस गळत | ges galat | gas leak | |
| `GAS_MR_LEAK` | mr | गॅस गळ | ges gal | gas leak | |
| `GAS_MR_LEAK` | mr | गॅसची गळती | gesachee galatee | gas leak | |
| `GAS_MR_LEAK` | mr | गॅस निघत | ges nighat | gas leak | |
| `GAS_MR_SMELL` | mr | गॅसचा वास | gesachaa vaas | smell of gas | |
| `GAS_MR_SMELL` | mr | गॅसचा दर्प | gesachaa darp | smell of gas | |
| `GAS_MR_SMELL` | mr | गॅस वास | ges vaas | smell of gas | |
| `GAS_MR_SMELL` | mr | गॅसचा दुर्गंध | gesachaa durgndh | smell of gas | |
| `GAS_MR_SMELL` | mr | गॅसचा स्मेल | gesachaa smel | smell of gas | |
| `GAS_MR_CYLINDER` | mr | सिलिंडर | silindar | cylinder, cylinder burst, cylinder explosion | |
| `GAS_MR_CYLINDER` | mr | सिलेंडर | silendar | cylinder, cylinder burst, cylinder explosion | |
| `GAS_MR_CYLINDER` | mr | गॅस सिलिंडर | ges silindar | cylinder, cylinder burst, cylinder explosion | |
| `GAS_MR_CYLINDER` | mr | सिलिंडर फुट | silindar phut | cylinder, cylinder burst, cylinder explosion | |
| `GAS_MR_CYLINDER` | mr | सिलिंडरचा स्फोट | silindarachaa sphot | cylinder, cylinder burst, cylinder explosion | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ka smell | gas ka smell | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki badbu | gas ki badbu | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki gandh | gas ki gandh | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki mahak | gas ki mahak | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki boo | gas ki boo | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ka badbu | gas ka badbu | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki smell | gas ki smell | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_SMELL` | hi-Latn | gas ki bu | gas ki bu | smell of gas, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas leak ho | gas leak ho | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas leak hai | gas leak hai | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas nikal raha | gas nikal raha | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas ris raha | gas ris raha | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas ka leakage | gas ka leakage | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas risaav | gas risaav | gas is leaking, typed in Latin letters | |
| `GAS_HI_LATN_LEAK` | hi-Latn | gas rissav | gas rissav | gas is leaking, typed in Latin letters | |
| `GAS_MR_LATN_VAS` | mr-Latn | gas cha vas | gas cha vas | smell of gas (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_VAS` | mr-Latn | gas cha vaas | gas cha vaas | smell of gas (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_VAS` | mr-Latn | gas cha was | gas cha was | smell of gas (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_VAS` | mr-Latn | gas cha dur | gas cha dur | smell of gas (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_VAS` | mr-Latn | gas cha smell | gas cha smell | smell of gas (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas leak zala | gas leak zala | gas leak (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas leak zali | gas leak zali | gas leak (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas galti zali | gas galti zali | gas leak (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas leak jhala | gas leak jhala | gas leak (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas galti | gas galti | gas leak (Marathi), typed in Latin letters | |
| `GAS_MR_LATN_LEAK` | mr-Latn | gas gal | gas gal | gas leak (Marathi), typed in Latin letters | |

### LIFT_STUCK

| Rule id | Language | Script text (as typed) | Transliteration (machine, approximate) | English meaning | Reviewed by / date |
|---|---|---|---|---|---|
| `LIFT_HI_PHANS` | hi | लिफ्ट में फंस | lipht men phns | stuck / trapped in the lift | |
| `LIFT_HI_PHANS` | hi | लिफ्ट में फँस | lipht men phns | stuck / trapped in the lift | |
| `LIFT_HI_PHANS` | hi | लिफ्ट के अंदर फंस | lipht ke andar phns | stuck / trapped in the lift | |
| `LIFT_HI_PHANS` | hi | लिफ्ट मे फंस | lipht me phns | stuck / trapped in the lift | |
| `LIFT_HI_PHANS` | hi | लिफ्ट में फस | lipht men phas | stuck / trapped in the lift | |
| `LIFT_HI_ATAK` | hi | लिफ्ट अटक | lipht atak | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_ATAK` | hi | लिफ्ट में अटक | lipht men atak | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_ATAK` | hi | लिफ्ट रुक गई | lipht ruk gaee | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_ATAK` | hi | लिफ्ट रुकी | lipht rukee | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_ATAK` | hi | लिफ्ट बीच में | lipht beech men | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_ATAK` | hi | लिफ्ट बीच मे | lipht beech me | lift is stuck, lift stopped, lift in the middle | |
| `LIFT_HI_BAND` | hi | लिफ्ट में बंद | lipht men bnd | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_BAND` | hi | लिफ्ट में कैद | lipht men kaid | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_BAND` | hi | लिफ्ट में फंसे | lipht men phnse | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_BAND` | hi | लिफ्ट में फंसी | lipht men phnsee | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_BAND` | hi | लिफ्ट में फंसा | lipht men phnsaa | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_BAND` | hi | लिफ्ट में लोग फंस | lipht men log phns | shut in / confined in the lift, people stuck in the lift | |
| `LIFT_HI_GIR` | hi | लिफ्ट गिर | lipht gir | the lift fell | |
| `LIFT_HI_GIR` | hi | लिफ्ट नीचे गिर | lipht neeche gir | the lift fell | |
| `LIFT_HI_GIR` | hi | लिफ्ट टूट कर गिर | lipht toot kar gir | the lift fell | |
| `LIFT_HI_GIR` | hi | लिफ्ट गिरी | lipht giree | the lift fell | |
| `LIFT_HI_DOOR` | hi | लिफ्ट का दरवाजा नहीं खुल | lipht kaa daravaajaa naheen khul | the lift door does not open | |
| `LIFT_HI_DOOR` | hi | लिफ्ट का दरवाज़ा नहीं खुल | lipht kaa daravaajaa naheen khul | the lift door does not open | |
| `LIFT_HI_DOOR` | hi | लिफ्ट का गेट नहीं खुल | lipht kaa get naheen khul | the lift door does not open | |
| `LIFT_HI_DOOR` | hi | लिफ्ट का दरवाजा नही खुल | lipht kaa daravaajaa nahee khul | the lift door does not open | |
| `LIFT_MR_ADAKAL` | mr | लिफ्टमध्ये अडकल | liphtamadhye adakal | stuck in the lift (I / she / they got stuck) | |
| `LIFT_MR_ADAKAL` | mr | लिफ्ट मध्ये अडकल | lipht madhye adakal | stuck in the lift (I / she / they got stuck) | |
| `LIFT_MR_ADAKAL` | mr | लिफ्टमध्ये अडक | liphtamadhye adak | stuck in the lift (I / she / they got stuck) | |
| `LIFT_MR_ADAKAL` | mr | लिफ्टमधे अडकल | liphtamadhe adakal | stuck in the lift (I / she / they got stuck) | |
| `LIFT_MR_ADAKAL` | mr | लिफ्ट मध्ये अडक | lipht madhye adak | stuck in the lift (I / she / they got stuck) | |
| `LIFT_MR_BAND` | mr | लिफ्टमध्ये बंद | liphtamadhye bnd | shut in the lift, confined, people stuck | |
| `LIFT_MR_BAND` | mr | लिफ्ट मध्ये बंद | lipht madhye bnd | shut in the lift, confined, people stuck | |
| `LIFT_MR_BAND` | mr | लिफ्टमध्ये कोंडल | liphtamadhye kondal | shut in the lift, confined, people stuck | |
| `LIFT_MR_BAND` | mr | लिफ्टमध्ये अडकून | liphtamadhye adakoon | shut in the lift, confined, people stuck | |
| `LIFT_MR_BAND` | mr | लिफ्टमध्ये लोक अडक | liphtamadhye lok adak | shut in the lift, confined, people stuck | |
| `LIFT_MR_THAMBLI` | mr | लिफ्ट मध्येच थांबल | lipht madhyech thaanbal | the lift stopped midway | |
| `LIFT_MR_THAMBLI` | mr | लिफ्ट मध्येच बंद | lipht madhyech bnd | the lift stopped midway | |
| `LIFT_MR_THAMBLI` | mr | लिफ्ट मधेच | lipht madhech | the lift stopped midway | |
| `LIFT_MR_THAMBLI` | mr | लिफ्टमध्येच थांबल | liphtamadhyech thaanbal | the lift stopped midway | |
| `LIFT_MR_THAMBLI` | mr | लिफ्ट मध्येच अडक | lipht madhyech adak | the lift stopped midway | |
| `LIFT_MR_PADLI` | mr | लिफ्ट कोसळ | lipht kosal | the lift fell / collapsed | |
| `LIFT_MR_PADLI` | mr | लिफ्ट पडली | lipht padalee | the lift fell / collapsed | |
| `LIFT_MR_PADLI` | mr | लिफ्ट खाली पडल | lipht khaalee padal | the lift fell / collapsed | |
| `LIFT_MR_PADLI` | mr | लिफ्ट वरून पडल | lipht varoon padal | the lift fell / collapsed | |
| `LIFT_MR_DAR` | mr | लिफ्टचा दरवाजा उघडत नाही | liphtachaa daravaajaa ughadat naahee | the lift door does not open | |
| `LIFT_MR_DAR` | mr | लिफ्टचे दार उघडत नाही | liphtache daar ughadat naahee | the lift door does not open | |
| `LIFT_MR_DAR` | mr | लिफ्टचा दरवाजा उघडत | liphtachaa daravaajaa ughadat | the lift door does not open | |
| `LIFT_MR_DAR` | mr | लिफ्टचे दार उघडत | liphtache daar ughadat | the lift door does not open | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift atak gayi | lift atak gayi | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift atak gaya | lift atak gaya | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift atki | lift atki | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift atak | lift atak | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift ruk gayi | lift ruk gayi | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift beech mein | lift beech mein | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_ATAK` | hi-Latn | lift beech me ruk | lift beech me ruk | lift is stuck, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift mein phans | lift mein phans | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift me phans | lift me phans | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift mein fans | lift mein fans | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift me fas | lift me fas | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift mein phansa | lift mein phansa | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift mein phase | lift mein phase | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_PHANS` | hi-Latn | lift ke andar phans | lift ke andar phans | stuck in the lift, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift mein band | lift mein band | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift me band | lift me band | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift ke andar band | lift ke andar band | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift ke andar fas | lift ke andar fas | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift gir gayi | lift gir gayi | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_HI_LATN_BAND` | hi-Latn | lift mein log phanse | lift mein log phanse | shut in the lift / lift fell, typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | lift madhe adakl | lift madhe adakl | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | lift madhye adakl | lift madhye adakl | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | lift madhe adkal | lift madhe adkal | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | lift madhe adakun | lift madhe adakun | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | liftmadhe adakl | liftmadhe adakl | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_ADAKLO` | mr-Latn | lift madhe adak | lift madhe adak | stuck in the lift (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_THAMBLI` | mr-Latn | lift madhech thambl | lift madhech thambl | the lift stopped midway / fell (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_THAMBLI` | mr-Latn | lift madhech band | lift madhech band | the lift stopped midway / fell (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_THAMBLI` | mr-Latn | lift thambli | lift thambli | the lift stopped midway / fell (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_THAMBLI` | mr-Latn | lift madhech | lift madhech | the lift stopped midway / fell (Marathi), typed in Latin letters | |
| `LIFT_MR_LATN_THAMBLI` | mr-Latn | lift padli | lift padli | the lift stopped midway / fell (Marathi), typed in Latin letters | |

### SHOCK

| Rule id | Language | Script text (as typed) | Transliteration (machine, approximate) | English meaning | Reviewed by / date |
|---|---|---|---|---|---|
| `SHOCK_HI_KARANT` | hi | करंट | karnt | 'current' = electric shock **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_KARANT` | hi | करेंट | karent | 'current' = electric shock **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_KARANT` | hi | करंट लगा | karnt lagaa | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करंट लग | karnt lag | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करेंट लग | karent lag | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करंट आ रहा | karnt aa rahaa | 'current' = electric shock **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_JHATKA` | hi | बिजली का झटका | bijalee kaa jhatakaa | a jolt of electricity, electric shock | |
| `SHOCK_HI_JHATKA` | hi | बिजली के झटके | bijalee ke jhatake | a jolt of electricity, electric shock | |
| `SHOCK_HI_JHATKA` | hi | बिजली झटका | bijalee jhatakaa | a jolt of electricity, electric shock | |
| `SHOCK_HI_JHATKA` | hi | बिजली का झटका लगा | bijalee kaa jhatakaa lagaa | a jolt of electricity, electric shock | |
| `SHOCK_HI_JHATKA` | hi | बिजली का शॉक | bijalee kaa shok | a jolt of electricity, electric shock | |
| `SHOCK_HI_SHOCK` | hi | शॉक | shok | shock, electric shock (loan word) | |
| `SHOCK_HI_SHOCK` | hi | शाक लग | shaak lag | shock, electric shock (loan word) | |
| `SHOCK_HI_SHOCK` | hi | शॉक लगा | shok lagaa | shock, electric shock (loan word) | |
| `SHOCK_HI_SHOCK` | hi | इलेक्ट्रिक शॉक | ilektrik shok | shock, electric shock (loan word) | |
| `SHOCK_HI_SHOCK` | hi | शौक लगा | shauk lagaa | shock, electric shock (loan word) | |
| `SHOCK_HI_TAR` | hi | नंगा तार | nngaa taar | bare / open / broken wire | |
| `SHOCK_HI_TAR` | hi | खुला तार | khulaa taar | bare / open / broken wire | |
| `SHOCK_HI_TAR` | hi | टूटा तार | tootaa taar | bare / open / broken wire | |
| `SHOCK_HI_TAR` | hi | तार टूट | taar toot | bare / open / broken wire | |
| `SHOCK_HI_TAR` | hi | बिजली का नंगा | bijalee kaa nngaa | bare / open / broken wire | |
| `SHOCK_HI_TAR` | hi | खुले तार | khule taar | bare / open / broken wire | |
| `SHOCK_HI_LAG` | hi | बिजली लग | bijalee lag | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | बिजली का करंट | bijalee kaa karnt | got electrocuted; current in the wall / tap / water **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_LAG` | hi | करंट आ | karnt aa | got electrocuted; current in the wall / tap / water **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_LAG` | hi | दीवार में करंट | deevaar men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | नल में करंट | nal men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | पानी में करंट | paanee men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा धक्का | vijechaa dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा झटका | vijechaa jhatakaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा शॉक | vijechaa shok | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | वीज धक्का | veej dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | वीजेचा धक्का | veejechaa dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचे धक्के | vijeche dhakke | electric shock (a blow of electricity) | |
| `SHOCK_MR_KARANT` | mr | करंट | karnt | got a shock of current **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_MR_KARANT` | mr | करंट लागला | karnt laagalaa | got a shock of current | |
| `SHOCK_MR_KARANT` | mr | करंट लागत | karnt laagat | got a shock of current | |
| `SHOCK_MR_KARANT` | mr | करंट आला | karnt aalaa | got a shock of current **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_MR_KARANT` | mr | करेंट लागला | karent laagalaa | got a shock of current | |
| `SHOCK_MR_SHOCK` | mr | शॉक | shok | got a shock | |
| `SHOCK_MR_SHOCK` | mr | शॉक लागला | shok laagalaa | got a shock | |
| `SHOCK_MR_SHOCK` | mr | शॉक बसला | shok basalaa | got a shock | |
| `SHOCK_MR_SHOCK` | mr | शॉक बसत | shok basat | got a shock | |
| `SHOCK_MR_SHOCK` | mr | शॉक लागत | shok laagat | got a shock | |
| `SHOCK_MR_BASLA` | mr | वीज लागली | veej laagalee | electricity struck me; electric jolt | |
| `SHOCK_MR_BASLA` | mr | वीज लागल | veej laagal | electricity struck me; electric jolt | |
| `SHOCK_MR_BASLA` | mr | विजेचा झटका बसला | vijechaa jhatakaa basalaa | electricity struck me; electric jolt | |
| `SHOCK_MR_BASLA` | mr | धक्का बसला विजे | dhakkaa basalaa vije | electricity struck me; electric jolt | |
| `SHOCK_MR_WIRE` | mr | उघडी वायर | ughadee vaayar | open wire, broken wire | |
| `SHOCK_MR_WIRE` | mr | उघड्या वायर | ughadyaa vaayar | open wire, broken wire | |
| `SHOCK_MR_WIRE` | mr | वायर तुटली | vaayar tutalee | open wire, broken wire | |
| `SHOCK_MR_WIRE` | mr | तार तुटली | taar tutalee | open wire, broken wire | |
| `SHOCK_MR_WIRE` | mr | उघडी तार | ughadee taar | open wire, broken wire | |
| `SHOCK_MR_WIRE` | mr | उघडा तार | ughadaa taar | open wire, broken wire | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock laga | shock laga | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock lag | shock lag | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock lagi | shock lagi | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock lagta | shock lagta | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock mara | shock mara | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_SHOCK` | hi-Latn | shock lag gaya | shock lag gaya | got a shock, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current laga | current laga | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current lag | current lag | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current lagta | current lagta | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current aa raha | current aa raha | got a shock of current, typed in Latin letters **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current aata | current aata | got a shock of current, typed in Latin letters **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karant laga | karant laga | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karant lag | karant lag | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karent laga | karent laga | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current maar | current maar | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatka | bijli ka jhatka | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatke | bijli ka jhatke | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatka laga | bijli ka jhatka laga | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli lag | bijli lag | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli lag gayi | bijli lag gayi | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka current | bijli ka current | electric jolt, typed in Latin letters **(counts only when a shock word is in the same text, D169)** | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | nanga taar | nanga taar | bare / broken wire, typed in Latin letters | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | nange taar | nange taar | bare / broken wire, typed in Latin letters | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | khula taar | khula taar | bare / broken wire, typed in Latin letters | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | khule taar | khule taar | bare / broken wire, typed in Latin letters | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | taar toot | taar toot | bare / broken wire, typed in Latin letters | |
| `SHOCK_HI_LATN_TAAR` | hi-Latn | taar tuta | taar tuta | bare / broken wire, typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | vijecha dhakka | vijecha dhakka | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | viji cha dhakka | viji cha dhakka | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | vijecha shock | vijecha shock | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | current laagla | current laagla | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | current lagla | current lagla | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | shock laagla | shock laagla | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | shock baisla | shock baisla | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_DHAKKA` | mr-Latn | karant laagla | karant laagla | electric shock (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_WIRE` | mr-Latn | ughadi tar | ughadi tar | open / broken wire (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_WIRE` | mr-Latn | ughadi wire | ughadi wire | open / broken wire (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_WIRE` | mr-Latn | wire tutli | wire tutli | open / broken wire (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_WIRE` | mr-Latn | tar tutli | tar tutli | open / broken wire (Marathi), typed in Latin letters | |
| `SHOCK_MR_LATN_WIRE` | mr-Latn | ughdi wire | ughdi wire | open / broken wire (Marathi), typed in Latin letters | |

### MEDICAL_VIOLENCE

A fifth category added by a human decision (D153): someone is hurt, ill, attacked or dead. It is NOT one of the brief's four. A hit is CRITICAL and goes to the duty manager like the others. The English rules are in `src/domain/complaints/safety.ts`; the words below are the Hindi, Marathi and romanised ones.

| Rule id | Language | Script text (as typed) | Transliteration (machine, approximate) | English meaning | Reviewed by / date |
|---|---|---|---|---|---|
| `MV_HI_AMBULANCE` | hi | एम्बुलेंस | embulens | ambulance / medical help needed | |
| `MV_HI_AMBULANCE` | hi | एंबुलेंस | enbulens | ambulance / medical help needed | |
| `MV_HI_AMBULANCE` | hi | एम्बुलेन्स | embulens | ambulance / medical help needed | |
| `MV_HI_AMBULANCE` | hi | एंबुलेन्स | enbulens | ambulance / medical help needed | |
| `MV_HI_AMBULANCE` | hi | अम्बुलेंस | ambulens | ambulance / medical help needed | |
| `MV_HI_AMBULANCE` | hi | ऐम्बुलेंस | aimbulens | ambulance / medical help needed | |
| `MV_HI_BEHOSH` | hi | बेहोश | behosh | unconscious / fainted | |
| `MV_HI_BEHOSH` | hi | अचेत | achet | unconscious / fainted | |
| `MV_HI_BEHOSH` | hi | होश नहीं | hosh naheen | unconscious / fainted | |
| `MV_HI_BEHOSH` | hi | होश में नहीं | hosh men naheen | unconscious / fainted | |
| `MV_HI_BEHOSH` | hi | बेसुध | besudh | unconscious / fainted | |
| `MV_HI_BREATH` | hi | सांस नहीं | saans naheen | cannot breathe / not breathing | |
| `MV_HI_BREATH` | hi | सांस रुक | saans ruk | cannot breathe / not breathing | |
| `MV_HI_BREATH` | hi | सांस लेने में | saans lene men | cannot breathe / not breathing | |
| `MV_HI_BREATH` | hi | सांस फूल | saans phool | cannot breathe / not breathing | |
| `MV_HI_BREATH` | hi | दम घुट | dam ghut | cannot breathe / not breathing | |
| `MV_HI_BREATH` | hi | सांस नही | saans nahee | cannot breathe / not breathing | |
| `MV_HI_CARDIAC` | hi | हार्ट अटैक | haart ataik | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | हार्टअटैक | haartataik | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | दिल का दौरा | dil kaa dauraa | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | दौरा पड़ | dauraa pada | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | मिर्गी | mirgee | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | सीने में दर्द | seene men dard | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | छाती में दर्द | chhaatee men dard | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | हृदयघात | hridayaghaat | heart attack, chest pain or seizure | |
| `MV_HI_CARDIAC` | hi | लकवा | lakavaa | heart attack, chest pain or seizure | |
| `MV_HI_KHOON` | hi | खून | khoon | blood / bleeding | |
| `MV_HI_KHOON` | hi | रक्त | rakt | blood / bleeding | |
| `MV_HI_KHOON` | hi | लहूलुहान | lahooluhaan | blood / bleeding | |
| `MV_HI_KHOON` | hi | रक्तस्राव | raktasraav | blood / bleeding | |
| `MV_HI_GHAYAL` | hi | घायल | ghaayal | injured / wounded | |
| `MV_HI_GHAYAL` | hi | जख्मी | jakhmee | injured / wounded | |
| `MV_HI_GHAYAL` | hi | जख्म | jakhm | injured / wounded | |
| `MV_HI_GHAYAL` | hi | गंभीर चोट | gnbheer chot | injured / wounded | |
| `MV_HI_GHAYAL` | hi | सिर में चोट | sir men chot | injured / wounded | |
| `MV_HI_GHAYAL` | hi | चोट लग | chot lag | injured / wounded | |
| `MV_HI_GHAYAL` | hi | हड्डी टूट | haddee toot | injured / wounded | |
| `MV_HI_GHAYAL` | hi | फ्रैक्चर | phraikchar | injured / wounded | |
| `MV_HI_GHAYAL` | hi | चोटिल | chotil | injured / wounded | |
| `MV_HI_WEAPON` | hi | चाकू | chaakoo | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | छुरा | chhuraa | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | छुरी | chhuree | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | गोली | golee | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | गोलीबारी | goleebaaree | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | बंदूक | bndook | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | बन्दूक | bandook | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | हथियार | hathiyaar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | पिस्तौल | pistaul | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | तलवार | talavaar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_WEAPON` | hi | कट्टा | kattaa | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_HI_ATTACK` | hi | हमला | hamalaa | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | हमले | hamale | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | हमलावर | hamalaavar | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | मारपीट | maarapeet | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | मार दिया | maar diyaa | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | मार डाला | maar daalaa | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | पिटाई | pitaaee | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | पीटा | peetaa | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | पीट रहे | peet rahe | attack, assault or a threat to kill | |
| `MV_HI_ATTACK` | hi | पीट रहा | peet rahaa | attack, assault or a threat to kill | |
| `MV_HI_DEATH` | hi | हत्या | hatyaa | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | कत्ल | katl | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मर गया | mar gayaa | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मर गई | mar gee | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मर गये | mar gaye | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मर गए | mar ge | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मौत | maut | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | लाश | laash | murder, death or a dead body | |
| `MV_HI_DEATH` | hi | मृत | mrit | murder, death or a dead body | |
| `MV_HI_DROWN_KIDNAP` | hi | अपहरण | apaharan | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | किडनैप | kidanaip | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | डूब रहा | doob rahaa | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | डूब रही | doob rahee | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | डूब गया | doob gayaa | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | डूब गई | doob gee | drowning or kidnapping | |
| `MV_HI_DROWN_KIDNAP` | hi | डूबने | doobane | drowning or kidnapping | |
| `MV_MR_AMBULANCE` | mr | रुग्णवाहिका | rugnavaahikaa | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | रुग्णवाहीका | rugnavaaheekaa | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | अॅम्ब्युलन्स | aembyulans | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | ऍम्ब्युलन्स | embyulans | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | ॲम्ब्युलन्स | ambyulans | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | अँब्युलन्स | anbyulans | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | एम्बुलेन्स | embulens | ambulance / medical help needed | |
| `MV_MR_AMBULANCE` | mr | अम्बुलन्स | ambulans | ambulance / medical help needed | |
| `MV_MR_BEHOSH` | mr | बेशुद्ध | beshuddh | unconscious / fainted | |
| `MV_MR_BEHOSH` | mr | बेशुध्द | beshudhd | unconscious / fainted | |
| `MV_MR_BEHOSH` | mr | बेहोश | behosh | unconscious / fainted | |
| `MV_MR_BEHOSH` | mr | शुद्ध हरपली | shuddh harapalee | unconscious / fainted | |
| `MV_MR_BEHOSH` | mr | शुद्ध हरपला | shuddh harapalaa | unconscious / fainted | |
| `MV_MR_BEHOSH` | mr | भोवळ | bhoval | unconscious / fainted | |
| `MV_MR_BREATH` | mr | श्वास घेता येत नाही | shvaas ghetaa yet naahee | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | श्वास घेण्यास त्रास | shvaas ghenyaas traas | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | श्वास थांबला | shvaas thaanbalaa | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | श्वास कोंडला | shvaas kondalaa | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | दम लागत | dam laagat | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | धाप लागत | dhaap laagat | cannot breathe / not breathing | |
| `MV_MR_BREATH` | mr | दम कोंडला | dam kondalaa | cannot breathe / not breathing | |
| `MV_MR_CARDIAC` | mr | हृदयविकार | hridayavikaar | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | हार्ट अटॅक | haart atek | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | हार्ट अॅटॅक | haart aetek | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | छातीत दुखत | chhaateet dukhat | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | छातीत कळ | chhaateet kal | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | फिट आली | phit aalee | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | फिट आला | phit aalaa | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | फेफरे | phephare | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | अर्धांगवायू | ardhaangavaayoo | heart attack, chest pain or seizure | |
| `MV_MR_CARDIAC` | mr | पक्षाघात | pakshaaghaat | heart attack, chest pain or seizure | |
| `MV_MR_RAKTA` | mr | रक्त | rakt | blood / bleeding | |
| `MV_MR_RAKTA` | mr | रक्तबंबाळ | raktabnbaal | blood / bleeding | |
| `MV_MR_RAKTA` | mr | रक्तस्राव | raktasraav | blood / bleeding | |
| `MV_MR_RAKTA` | mr | रक्तस्त्राव | raktastraav | blood / bleeding | |
| `MV_MR_JAKHMI` | mr | जखम | jakham | injured / wounded | |
| `MV_MR_JAKHMI` | mr | गंभीर जखम | gnbheer jakham | injured / wounded | |
| `MV_MR_JAKHMI` | mr | डोक्याला मार | dokyaalaa maar | injured / wounded | |
| `MV_MR_JAKHMI` | mr | डोक्याला लागले | dokyaalaa laagale | injured / wounded | |
| `MV_MR_JAKHMI` | mr | हाड मोडले | haad modale | injured / wounded | |
| `MV_MR_JAKHMI` | mr | फ्रॅक्चर | phrekchar | injured / wounded | |
| `MV_MR_WEAPON` | mr | चाकू | chaakoo | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | गोळी | golee | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | गोळीबार | goleebaar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | बंदूक | bndook | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | बंदुक | bnduk | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | शस्त्र | shastr | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | पिस्तूल | pistool | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | तलवार | talavaar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_WEAPON` | mr | कोयता | koyataa | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet) | |
| `MV_MR_ATTACK` | mr | हल्ला | hallaa | attack, assault or a threat to kill | |
| `MV_MR_ATTACK` | mr | हल्लेखोर | hallekhor | attack, assault or a threat to kill | |
| `MV_MR_ATTACK` | mr | मारहाण | maarahaan | attack, assault or a threat to kill | |
| `MV_MR_ATTACK` | mr | मारामारी | maaraamaaree | attack, assault or a threat to kill | |
| `MV_MR_ATTACK` | mr | जीवे मार | jeeve maar | attack, assault or a threat to kill | |
| `MV_MR_ATTACK` | mr | मारून टाक | maaroon taak | attack, assault or a threat to kill | |
| `MV_MR_DEATH` | mr | खून | khoon | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | हत्या | hatyaa | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | मृत्यू | mrityoo | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | मृतदेह | mritadeh | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | प्रेत | pret | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | मरण पाव | maran paav | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | जीव गेला | jeev gelaa | murder, death or a dead body | |
| `MV_MR_DEATH` | mr | जीव गेली | jeev gelee | murder, death or a dead body | |
| `MV_MR_DROWN_KIDNAP` | mr | अपहरण | apaharan | drowning or kidnapping | |
| `MV_MR_DROWN_KIDNAP` | mr | किडनॅप | kidanep | drowning or kidnapping | |
| `MV_MR_DROWN_KIDNAP` | mr | बुडत | budat | drowning or kidnapping | |
| `MV_MR_DROWN_KIDNAP` | mr | बुडाला | budaalaa | drowning or kidnapping | |
| `MV_MR_DROWN_KIDNAP` | mr | बुडाली | budaalee | drowning or kidnapping | |
| `MV_MR_DROWN_KIDNAP` | mr | बुडून | budoon | drowning or kidnapping | |
| `MV_HI_LATN_AMBULANCE` | hi-Latn | ambulance bulao | ambulance bulao | ambulance / medical help needed, typed in Latin letters | |
| `MV_HI_LATN_AMBULANCE` | hi-Latn | ambulance bulaiye | ambulance bulaiye | ambulance / medical help needed, typed in Latin letters | |
| `MV_HI_LATN_AMBULANCE` | hi-Latn | ambulance bula do | ambulance bula do | ambulance / medical help needed, typed in Latin letters | |
| `MV_HI_LATN_AMBULANCE` | hi-Latn | ambulance chahiye | ambulance chahiye | ambulance / medical help needed, typed in Latin letters | |
| `MV_HI_LATN_AMBULANCE` | hi-Latn | ambulans | ambulans | ambulance / medical help needed, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | behosh | behosh | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | behoosh | behoosh | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | behosh ho gaya | behosh ho gaya | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | behosh ho gayi | behosh ho gayi | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | hosh nahi | hosh nahi | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | hosh nahin | hosh nahin | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | hosh me nahi | hosh me nahi | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BEHOSH` | hi-Latn | hosh mein nahi | hosh mein nahi | unconscious / fainted, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans nahi | saans nahi | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans nahin | saans nahin | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans nhi | saans nhi | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans ruk | saans ruk | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans lene mein takleef | saans lene mein takleef | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | saans lene me dikkat | saans lene me dikkat | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | dam ghut | dam ghut | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_BREATH` | hi-Latn | dum ghut | dum ghut | cannot breathe / not breathing, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | dil ka daura | dil ka daura | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | dil ka dora | dil ka dora | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | daura pada | daura pada | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | mirgi | mirgi | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | seene mein dard | seene mein dard | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | seene me dard | seene me dard | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | chhati mein dard | chhati mein dard | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | chhati me dard | chhati me dard | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_CARDIAC` | hi-Latn | lakwa | lakwa | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | khoon | khoon | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | khun | khun | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | khoon beh raha | khoon beh raha | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | khoon nikal raha | khoon nikal raha | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | lahuluhan | lahuluhan | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | rakt | rakt | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_KHOON` | hi-Latn | khoon nikla | khoon nikla | blood / bleeding, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | ghayal | ghayal | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | zakhmi | zakhmi | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | jakhmi | jakhmi | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | chot lagi | chot lagi | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | chot lag gayi | chot lag gayi | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | gambhir chot | gambhir chot | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | sar mein chot | sar mein chot | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | haddi tut | haddi tut | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_GHAYAL` | hi-Latn | haddi toot | haddi toot | injured / wounded, typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | chaku | chaku | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | chakoo | chakoo | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | chaaku | chaaku | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | goli | goli | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | goliyan | goliyan | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | goli chali | goli chali | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | bandook | bandook | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | banduk | banduk | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | talwar | talwar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | katta | katta | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | tamancha | tamancha | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | hathiyar | hathiyar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | chhura | chhura | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_WEAPON` | hi-Latn | chhuri | chhuri | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | hamla | hamla | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | hamla kiya | hamla kiya | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | hamlawar | hamlawar | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | maar diya | maar diya | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | maar dala | maar dala | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | maar daala | maar daala | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | maarpit | maarpit | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | marpit | marpit | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | maar peet | maar peet | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_ATTACK` | hi-Latn | pitai | pitai | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | hatya | hatya | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | katl | katl | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | qatal | qatal | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | mar gaya | mar gaya | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | mar gayi | mar gayi | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | mar gaye | mar gaye | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | maut | maut | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | laash | laash | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | mrit | mrit | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DEATH` | hi-Latn | jaan se maar | jaan se maar | murder, death or a dead body, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | doob raha | doob raha | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | doob rahi | doob rahi | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | doob gaya | doob gaya | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | doob gayi | doob gayi | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | apaharan | apaharan | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | agwa | agwa | drowning or kidnapping, typed in Latin letters | |
| `MV_HI_LATN_DROWN_KIDNAP` | hi-Latn | agva | agva | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | ambulance bolava | ambulance bolava | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | ambulance bolwa | ambulance bolwa | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | ambulance pathva | ambulance pathva | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | ambulance pahije | ambulance pahije | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | rugnavahika | rugnavahika | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_AMBULANCE` | mr-Latn | rugnavahika bolava | rugnavahika bolava | ambulance / medical help needed, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | beshudh | beshudh | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | beshuddh | beshuddh | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | beshuddha | beshuddha | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | bhoval | bhoval | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | bhowal | bhowal | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | bhoval aali | bhoval aali | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | chakkar yeun pad | chakkar yeun pad | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | shudh haravli | shudh haravli | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | behosh zala | behosh zala | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BEHOSH` | mr-Latn | behosh zali | behosh zali | unconscious / fainted, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | shwas gheta yet nahi | shwas gheta yet nahi | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | shvas gheta yet nahi | shvas gheta yet nahi | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | shwas thambla | shwas thambla | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | dam lagto | dam lagto | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | dhaap lagte | dhaap lagte | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | dhap lagte | dhap lagte | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | dam kondla | dam kondla | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | shwas kondla | shwas kondla | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_BREATH` | mr-Latn | shwas ghenyas tras | shwas ghenyas tras | cannot breathe / not breathing, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | hrudayvikar | hrudayvikar | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | hruday vikar | hruday vikar | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | chhatit dukhtay | chhatit dukhtay | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | chhatit dukhte | chhatit dukhte | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | chhatit dukhat | chhatit dukhat | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | chhatit kal | chhatit kal | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | chatit dukhtay | chatit dukhtay | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | fit aali | fit aali | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | fit aala | fit aala | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_CARDIAC` | mr-Latn | phephre | phephre | heart attack, chest pain or seizure, typed in Latin letters | |
| `MV_MR_LATN_RAKTA` | mr-Latn | rakta | rakta | blood / bleeding, typed in Latin letters | |
| `MV_MR_LATN_RAKTA` | mr-Latn | raktabambal | raktabambal | blood / bleeding, typed in Latin letters | |
| `MV_MR_LATN_RAKTA` | mr-Latn | raktasrav | raktasrav | blood / bleeding, typed in Latin letters | |
| `MV_MR_LATN_RAKTA` | mr-Latn | raktastrav | raktastrav | blood / bleeding, typed in Latin letters | |
| `MV_MR_LATN_RAKTA` | mr-Latn | rakta yet aahe | rakta yet aahe | blood / bleeding, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | jakhmi | jakhmi | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | jakhami | jakhami | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | jakham | jakham | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | jakham zali | jakham zali | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | jakhmi zala | jakhmi zala | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | gambhir jakham | gambhir jakham | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | dokyala mar | dokyala mar | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | dokyala lagle | dokyala lagle | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_JAKHMI` | mr-Latn | had modle | had modle | injured / wounded, typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | chaku | chaku | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | chakku | chakku | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | golibar | golibar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | golibaar | golibaar | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | goli zadli | goli zadli | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | bandhuk | bandhuk | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | shastra | shastra | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | pistool | pistool | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_WEAPON` | mr-Latn | koyta | koyta | knife, gun or other weapon (note: 'goli' / 'गोळी' also means a tablet), typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | halla | halla | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | halla kela | halla kela | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | hallekhor | hallekhor | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | marhan | marhan | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | maramari | maramari | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | jeeve mar | jeeve mar | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | jive mar | jive mar | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | marun taka | marun taka | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_ATTACK` | mr-Latn | marun takle | marun takle | attack, assault or a threat to kill, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | khoon zala | khoon zala | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | khun zala | khun zala | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | khoon kela | khoon kela | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | hatya zali | hatya zali | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | mrutyu | mrutyu | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | mrityu | mrityu | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | mrutyu zala | mrutyu zala | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | mrutdeh | mrutdeh | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | mrutadeh | mrutadeh | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | jeev gela | jeev gela | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | jiv gela | jiv gela | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | maran pavla | maran pavla | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DEATH` | mr-Latn | maran pavli | maran pavli | murder, death or a dead body, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | budat aahe | budat aahe | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | budtay | budtay | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | budun | budun | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | budala | budala | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | budali | budali | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | apaharan | apaharan | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | kidnap zala | kidnap zala | drowning or kidnapping, typed in Latin letters | |
| `MV_MR_LATN_DROWN_KIDNAP` | mr-Latn | kidnap kela | kidnap kela | drowning or kidnapping, typed in Latin letters | |

### Accepted false positives of MEDICAL_VIOLENCE

These sentences hit although nobody is hurt. They are accepted on purpose (high recall, no negation) and are tests in
`tests/domain/complaints/medical-violence-cases.ts` (`MV_ACCEPTED_FALSE_POSITIVES`), so a change that stops them is a decision.

- English: "blood donation camp", "blood test", "kitchen knife" (a set for sale), "the plant died", "a photo shot", "passed out snacks", "sword fern", "a stroke of luck".
- Hindi and Marathi: `रक्तदान शिविर` (blood donation camp), `गोली` / `गोळी` (also a tablet), and the same typed in Latin letters (`goli leke aana`, `rakt daan`).

No self-harm word (for example "suicide") is in the list: that is a separate human decision.
