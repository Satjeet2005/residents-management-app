# Safety words: list for review

**These lists are NOT yet verified by a native speaker.** The Hindi and Marathi words and phrases below were written by the agent that built the
classifier, from general knowledge of the languages, to catch a fire, a gas leak, a person stuck in a lift and an electric shock when a resident
writes in Hindi, Marathi, or Hindi or Marathi typed in Latin letters. They may contain wrong spellings, words that do not mean what the English
column says, missing common phrases, and words that are too general (a false alarm costs a phone call; a missed fire costs far more, so the
rules are written to catch too much rather than too little: see `docs/complaint-classification.md`).

The transliteration column was made by a simple program and is only a help to read the script; it is not a standard scheme and some
spellings are rough. The English meaning is per rule. English rules are not listed here (they are in `src/domain/complaints/safety.ts`).

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
   That is acceptable if it is common in real incidents; say so, or ask for the rule to be narrowed.
4. Which common phrases are missing for the four categories: fire, gas, someone stuck in a lift, electric shock?

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
| `SHOCK_HI_KARANT` | hi | करंट | karnt | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करेंट | karent | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करंट लगा | karnt lagaa | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करंट लग | karnt lag | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करेंट लग | karent lag | 'current' = electric shock (also hits a bill for 'current') | |
| `SHOCK_HI_KARANT` | hi | करंट आ रहा | karnt aa rahaa | 'current' = electric shock (also hits a bill for 'current') | |
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
| `SHOCK_HI_LAG` | hi | बिजली का करंट | bijalee kaa karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | करंट आ | karnt aa | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | दीवार में करंट | deevaar men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | नल में करंट | nal men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_HI_LAG` | hi | पानी में करंट | paanee men karnt | got electrocuted; current in the wall / tap / water | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा धक्का | vijechaa dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा झटका | vijechaa jhatakaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचा शॉक | vijechaa shok | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | वीज धक्का | veej dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | वीजेचा धक्का | veejechaa dhakkaa | electric shock (a blow of electricity) | |
| `SHOCK_MR_DHAKKA` | mr | विजेचे धक्के | vijeche dhakke | electric shock (a blow of electricity) | |
| `SHOCK_MR_KARANT` | mr | करंट | karnt | got a shock of current | |
| `SHOCK_MR_KARANT` | mr | करंट लागला | karnt laagalaa | got a shock of current | |
| `SHOCK_MR_KARANT` | mr | करंट लागत | karnt laagat | got a shock of current | |
| `SHOCK_MR_KARANT` | mr | करंट आला | karnt aalaa | got a shock of current | |
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
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current aa raha | current aa raha | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current aata | current aata | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karant laga | karant laga | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karant lag | karant lag | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | karent laga | karent laga | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_CURRENT` | hi-Latn | current maar | current maar | got a shock of current, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatka | bijli ka jhatka | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatke | bijli ka jhatke | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka jhatka laga | bijli ka jhatka laga | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli lag | bijli lag | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli lag gayi | bijli lag gayi | electric jolt, typed in Latin letters | |
| `SHOCK_HI_LATN_JHATKA` | hi-Latn | bijli ka current | bijli ka current | electric jolt, typed in Latin letters | |
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
