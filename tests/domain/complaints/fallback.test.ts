import { describe, expect, it } from "vitest";
import { classifyByKeywords } from "@/domain/complaints/fallback";
import type { CategoryCode } from "@/domain/complaints/taxonomy";

type Row = [text: string, category: CategoryCode | null, urgency: "HIGH" | "NORMAL" | "LOW"];

const ENGLISH: Row[] = [
  ["There is a water leak in my bathroom", "PLUMBING", "NORMAL"],
  ["the tap is leaking", "PLUMBING", "NORMAL"],
  ["drain is blocked", "PLUMBING", "NORMAL"],
  ["the pipe has burst", "PLUMBING", "NORMAL"],
  ["sewage overflow near tower 3", "PLUMBING", "NORMAL"],
  ["no water since morning", "PLUMBING", "NORMAL"],
  ["toilet flush is not working", "PLUMBING", "NORMAL"],
  ["seepage on the bedroom wall", "PLUMBING", "NORMAL"],
  ["plumber needed", "PLUMBING", "NORMAL"],
  ["light is not working in the corridor", "ELECTRICAL", "NORMAL"],
  ["no electricity since last night", "ELECTRICAL", "NORMAL"],
  ["the fan switch is broken", "ELECTRICAL", "NORMAL"],
  ["a wire is hanging loose", "ELECTRICAL", "NORMAL"],
  ["bulb has fused", "ELECTRICAL", "NORMAL"],
  ["power cut every evening", "ELECTRICAL", "NORMAL"],
  ["the meter is not showing", "ELECTRICAL", "NORMAL"],
  ["socket is not working", "ELECTRICAL", "NORMAL"],
  ["inverter is beeping", "ELECTRICAL", "NORMAL"],
  ["lift is not working", "LIFT", "NORMAL"],
  ["the elevator makes a noise", "LIFT", "NORMAL"],
  ["lifts are very slow", "LIFT", "NORMAL"],
  ["the lift door is damaged", "LIFT", "NORMAL"],
  ["elevator button is broken", "LIFT", "NORMAL"],
  ["garbage not collected", "HOUSEKEEPING", "NORMAL"],
  ["the corridor is dirty", "HOUSEKEEPING", "NORMAL"],
  ["the dustbin is full", "HOUSEKEEPING", "NORMAL"],
  ["cleaning is not done", "HOUSEKEEPING", "NORMAL"],
  ["the sweeper did not come", "HOUSEKEEPING", "NORMAL"],
  ["trash near the gate", "HOUSEKEEPING", "NORMAL"],
  ["housekeeping staff absent", "HOUSEKEEPING", "NORMAL"],
  ["loud noise at night", "OTHER", "NORMAL"],
  ["parking problem", "OTHER", "NORMAL"],
  ["stray dogs in the compound", "OTHER", "NORMAL"],
  ["the security guard is sleeping", "OTHER", "NORMAL"],
  ["water leak, please fix urgently", "PLUMBING", "HIGH"],
  ["light not working, fix immediately", "ELECTRICAL", "HIGH"],
  ["lift is slow, need it asap", "LIFT", "HIGH"],
  ["it is an emergency, the tap has no water", "PLUMBING", "HIGH"],
  ["tap leaking, no hurry", "PLUMBING", "LOW"],
  ["garbage not collected, not urgent", "HOUSEKEEPING", "LOW"],
  ["fix the lift whenever you can", "LIFT", "LOW"],
  ["the light can be fixed at your convenience", "ELECTRICAL", "LOW"],
  ["whenever possible but urgent: the tap is leaking", "PLUMBING", "HIGH"],
];

const HINDI: Row[] = [
  ["नल से पानी टपक रहा है", "PLUMBING", "NORMAL"],
  ["पानी नहीं आ रहा", "PLUMBING", "NORMAL"],
  ["नाली जाम है", "PLUMBING", "NORMAL"],
  ["टंकी ओवरफ्लो हो रही है", "PLUMBING", "NORMAL"],
  ["पाइप फट गया है", "PLUMBING", "NORMAL"],
  ["बाथरूम में रिसाव है", "PLUMBING", "NORMAL"],
  ["सीवेज की समस्या है", "PLUMBING", "NORMAL"],
  ["बिजली नहीं है", "ELECTRICAL", "NORMAL"],
  ["लाइट खराब है", "ELECTRICAL", "NORMAL"],
  ["स्विच टूटा है", "ELECTRICAL", "NORMAL"],
  ["पंखा नहीं चल रहा", "ELECTRICAL", "NORMAL"],
  ["बल्ब फ्यूज हो गया", "ELECTRICAL", "NORMAL"],
  ["मीटर खराब है", "ELECTRICAL", "NORMAL"],
  ["तार लटक रहा है", "ELECTRICAL", "NORMAL"],
  ["बत्ती गुल है", "ELECTRICAL", "NORMAL"],
  ["लिफ्ट खराब है", "LIFT", "NORMAL"],
  ["लिफ्ट बहुत धीमी है", "LIFT", "NORMAL"],
  ["लिफ़्ट का बटन टूटा है", "LIFT", "NORMAL"],
  ["कचरा नहीं उठा", "HOUSEKEEPING", "NORMAL"],
  ["सफाई नहीं हुई", "HOUSEKEEPING", "NORMAL"],
  ["गंदगी फैली है", "HOUSEKEEPING", "NORMAL"],
  ["झाड़ू नहीं लगी", "HOUSEKEEPING", "NORMAL"],
  ["कूड़ा पड़ा है", "HOUSEKEEPING", "NORMAL"],
  ["डस्टबिन भरा है", "HOUSEKEEPING", "NORMAL"],
  ["स्वच्छता की कमी है", "HOUSEKEEPING", "NORMAL"],
  ["शोर बहुत है", "OTHER", "NORMAL"],
  ["पार्किंग की समस्या है", "OTHER", "NORMAL"],
  ["कुत्ते परेशान करते हैं", "OTHER", "NORMAL"],
  ["सुरक्षा गार्ड नहीं है", "OTHER", "NORMAL"],
  ["पानी का रिसाव तुरंत ठीक करो", "PLUMBING", "HIGH"],
  ["बिजली तुरंत चाहिए", "ELECTRICAL", "HIGH"],
  ["लिफ्ट जल्दी ठीक करें", "LIFT", "HIGH"],
  ["कचरा कभी भी उठा लो", "HOUSEKEEPING", "LOW"],
  ["सफाई के लिए कोई जल्दी नहीं है", "HOUSEKEEPING", "LOW"],
  ["लाईट की मरम्मत तत्काल करें", "ELECTRICAL", "HIGH"],
  ["फ़ैन का स्विच टूटा है", "ELECTRICAL", "NORMAL"],
  ["नल में पानी नहीं आता", "PLUMBING", "NORMAL"],
  ["टंकी का पानी गंदा है", "PLUMBING", "NORMAL"],
  ["झाड़ू और सफाई नहीं हुई", "HOUSEKEEPING", "NORMAL"],
  ["शोर और कुत्ते", "OTHER", "NORMAL"],
  ["लिफ्ट में आवाज आती है", "LIFT", "NORMAL"],
];

const MARATHI: Row[] = [
  ["नळाला पाणी येत नाही", "PLUMBING", "NORMAL"],
  ["पाणी गळती आहे", "PLUMBING", "NORMAL"],
  ["पाईप फुटला आहे", "PLUMBING", "NORMAL"],
  ["टाकी ओसंडून वाहतेय", "PLUMBING", "NORMAL"],
  ["गटार तुंबले आहे", "PLUMBING", "NORMAL"],
  ["नळ गळत आहे", "PLUMBING", "NORMAL"],
  ["तोटी तुटली आहे", "PLUMBING", "NORMAL"],
  ["वीज गेली आहे", "ELECTRICAL", "NORMAL"],
  ["लाईट बंद आहे", "ELECTRICAL", "NORMAL"],
  ["दिवा लागत नाही", "ELECTRICAL", "NORMAL"],
  ["पंखा चालत नाही", "ELECTRICAL", "NORMAL"],
  ["वायर तुटली आहे", "ELECTRICAL", "NORMAL"],
  ["मीटर बिघडला आहे", "ELECTRICAL", "NORMAL"],
  ["स्विच खराब आहे", "ELECTRICAL", "NORMAL"],
  ["बत्ती नाही", "ELECTRICAL", "NORMAL"],
  ["लिफ्ट बंद आहे", "LIFT", "NORMAL"],
  ["लिफ्ट खूप हळू आहे", "LIFT", "NORMAL"],
  ["लिफ्टचे दार तुटले आहे", "LIFT", "NORMAL"],
  ["कचरा उचलला नाही", "HOUSEKEEPING", "NORMAL"],
  ["सफाई झाली नाही", "HOUSEKEEPING", "NORMAL"],
  ["स्वच्छता नाही", "HOUSEKEEPING", "NORMAL"],
  ["घाण पसरली आहे", "HOUSEKEEPING", "NORMAL"],
  ["केर काढला नाही", "HOUSEKEEPING", "NORMAL"],
  ["झाडू मारली नाही", "HOUSEKEEPING", "NORMAL"],
  ["आवाज खूप आहे", "OTHER", "NORMAL"],
  ["पार्किंगचा प्रश्न आहे", "OTHER", "NORMAL"],
  ["कुत्रे त्रास देतात", "OTHER", "NORMAL"],
  ["शेजारी भांडतात", "OTHER", "NORMAL"],
  ["पाणी गळती लगेच थांबवा", "PLUMBING", "HIGH"],
  ["वीज ताबडतोब द्या", "ELECTRICAL", "HIGH"],
  ["लिफ्ट तातडीने दुरुस्त करा", "LIFT", "HIGH"],
  ["कचरा कधीही उचला", "HOUSEKEEPING", "LOW"],
  ["घाई नाही, कचरा उचला", "HOUSEKEEPING", "LOW"],
  ["लाईट त्वरित बदला", "ELECTRICAL", "HIGH"],
  ["नळाची तोटी गळते", "PLUMBING", "NORMAL"],
  ["टाकीचे पाणी घाण आहे", "PLUMBING", "NORMAL"],
  ["पंखा आणि वायर खराब", "ELECTRICAL", "NORMAL"],
  ["सफाई आणि कचरा", "HOUSEKEEPING", "NORMAL"],
  ["लिफ्ट मध्ये आवाज येतो", "LIFT", "NORMAL"],
  ["कुत्रे आणि आवाज", "OTHER", "NORMAL"],
];

const HINGLISH: Row[] = [
  ["nal se paani tapak raha hai", "PLUMBING", "NORMAL"],
  ["paani nahi aa raha", "PLUMBING", "NORMAL"],
  ["naali band hai", "PLUMBING", "NORMAL"],
  ["tanki overflow ho rahi hai", "PLUMBING", "NORMAL"],
  ["pani leak ho raha hai", "PLUMBING", "NORMAL"],
  ["gatar choke hai", "PLUMBING", "NORMAL"],
  ["tonti kharab hai", "PLUMBING", "NORMAL"],
  ["bijli nahi hai", "ELECTRICAL", "NORMAL"],
  ["light kharab hai", "ELECTRICAL", "NORMAL"],
  ["switch toot gaya", "ELECTRICAL", "NORMAL"],
  ["pankha nahi chal raha", "ELECTRICAL", "NORMAL"],
  ["taar latak raha hai", "ELECTRICAL", "NORMAL"],
  ["batti gul hai", "ELECTRICAL", "NORMAL"],
  ["meter kharab hai", "ELECTRICAL", "NORMAL"],
  ["vij gayi hai", "ELECTRICAL", "NORMAL"],
  ["lift kharab hai", "LIFT", "NORMAL"],
  ["lift band hai", "LIFT", "NORMAL"],
  ["lift bahut slow hai", "LIFT", "NORMAL"],
  ["kachra nahi utha", "HOUSEKEEPING", "NORMAL"],
  ["safai nahi hui", "HOUSEKEEPING", "NORMAL"],
  ["gandagi hai", "HOUSEKEEPING", "NORMAL"],
  ["jhadu nahi lagi", "HOUSEKEEPING", "NORMAL"],
  ["kooda pada hai", "HOUSEKEEPING", "NORMAL"],
  ["ghan hai", "HOUSEKEEPING", "NORMAL"],
  ["shor bahut hai", "OTHER", "NORMAL"],
  ["kutta pareshan karta hai", "OTHER", "NORMAL"],
  ["parking ka problem hai", "OTHER", "NORMAL"],
  ["paani leak turant thik karo", "PLUMBING", "HIGH"],
  ["bijli jaldi chahiye", "ELECTRICAL", "HIGH"],
  ["lift jaldi theek karo", "LIFT", "HIGH"],
  ["kachra kabhi bhi utha lo", "HOUSEKEEPING", "LOW"],
  ["safai ke liye jaldi nahi hai", "HOUSEKEEPING", "LOW"],
  ["light fix whenever you can", "ELECTRICAL", "LOW"],
  ["naali aur tanki ka paani", "PLUMBING", "NORMAL"],
  ["pankha aur switch kharab", "ELECTRICAL", "NORMAL"],
  ["safai aur kachra", "HOUSEKEEPING", "NORMAL"],
  ["lift ki aawaz", "LIFT", "NORMAL"],
  ["shor aur kutte", "OTHER", "NORMAL"],
  ["urgent hai, nal toot gaya", "PLUMBING", "HIGH"],
  ["jaldi nahi hai, light badal do", "ELECTRICAL", "LOW"],
  ["tonti se pani tapak raha hai", "PLUMBING", "NORMAL"],
];

describe("CP4 classifyByKeywords: each language family", () => {
  for (const [family, rows] of [["English", ENGLISH], ["Hindi", HINDI], ["Marathi", MARATHI], ["Hinglish", HINGLISH]] as const) {
    it(`${family}: at least 40 cases`, () => {
      expect(rows.length).toBeGreaterThanOrEqual(40);
    });

    it.each(rows)(`${family}: %j is %s with urgency %s`, (text, category, urgency) => {
      const result = classifyByKeywords(text);
      expect({ category: result.category, urgency: result.urgency }).toEqual({ category, urgency });
      expect(result.matched.length).toBeGreaterThan(0);
    });
  }
});

describe("CP4 ties and nulls", () => {
  it.each([
    ["the lift light is not working", "English"],
    ["water in the lift", "English"],
    ["garbage and water everywhere", "English"],
    ["dustbin overflowing", "English"],
    ["लिफ्ट की लाइट खराब है", "Hindi"],
    ["लिफ्ट में पानी है", "Hindi"],
    ["लिफ्टचा दिवा बंद आहे", "Marathi"],
    ["लिफ्टमध्ये पाणी आहे", "Marathi"],
    ["lift ki light kharab hai", "Hinglish"],
    ["lift mein paani hai", "Hinglish"],
  ])("a tie between categories (%j, %s) gives null for triage", (text) => {
    const result = classifyByKeywords(text);
    expect(result.category).toBeNull();
    expect(result.matched.length).toBeGreaterThan(1);
  });

  it("the higher score wins over a single mention of another category", () => {
    expect(classifyByKeywords("water leak near the lift").category).toBe("PLUMBING");
  });

  it("a main category beats OTHER words in the same sentence", () => {
    expect(classifyByKeywords("lift noise at night, parking too").category).toBe("LIFT");
  });

  it.each(["", "   ", "hello", "please help", "thank you", "something is wrong", "नमस्ते", "कृपया मदद करें", "नमस्कार", "namaste", "madad karo", "🔥", "12345"])("%j has no category, urgency NORMAL, nothing matched", (text) => {
    expect(classifyByKeywords(text)).toEqual({ category: null, urgency: "NORMAL", matched: [] });
  });

  it("an urgency word alone still gives an urgency but no category", () => {
    expect(classifyByKeywords("please do it urgently")).toMatchObject({ category: null, urgency: "HIGH" });
    expect(classifyByKeywords("no hurry at all")).toMatchObject({ category: null, urgency: "LOW" });
  });

  it("is deterministic and the matched list has no repeats", () => {
    const text = "water water leak leak urgent urgent";
    expect(classifyByKeywords(text)).toEqual(classifyByKeywords(text));
    const matched = classifyByKeywords(text).matched;
    expect(new Set(matched).size).toBe(matched.length);
  });

  it("never throws on odd input and reads only what the safety rules would leave: it knows nothing about safety words", () => {
    expect(() => classifyByKeywords(undefined as unknown as string)).not.toThrow();
    expect(() => classifyByKeywords("\u0000\uD800 ".repeat(3000))).not.toThrow();
    expect(classifyByKeywords("there is a fire")).toEqual({ category: null, urgency: "NORMAL", matched: [] });
  });
});
