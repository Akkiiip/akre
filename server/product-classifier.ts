export type ProductClassification = "PRODUCT" | "NON_PRODUCT" | "AMBIGUOUS";

const NON_PRODUCT_PATTERNS = [
  /\b(weather|forecast|temperature|rain|storm|earthquake|election|results?|score|match|fixture|schedule|live score)\b/i,
  /\b(news|headline|breaking|politics|politician|prime minister|president|celebrity|actor|actress|movie|film|trailer|episode|series|serial|chatgpt download|photopea)\b/i,
  /\b(stock market|share price|bitcoin price|gold price|sensex|nifty)\b/i,
];

const PRODUCT_RULES: Array<[string, RegExp]> = [
  ["beauty", /\b(serum|sunscreen|lipstick|makeup|concealer|moisturizer|shampoo|conditioner|skincare|hair oil|trimmer|straightener|face roller|gua sha)\b/i],
  ["home", /\b(organizer|storage|cushion|curtain|lamp|light|cleaning|mop|hanger|decor|pillow|bedsheet|trash can|air purifier|vacuum|air quality monitor)\b/i],
  ["kitchen", /\b(chopper|bottle|mixer|grinder|air fryer|fryer|container|lunch box|kitchen|cookware|peeler|grater|whisk|matcha whisk|matcha bowl|blender|cooktop|induction burner|dishwasher)\b/i],
  ["fashion", /\b(dress|shirt|tshirt|t-shirt|kurti|saree|jeans|jacket|hoodie|shoes|sandal|slipper|bag|wallet)\b/i],
  ["accessories", /\b(jewellery|jewelry|earrings|necklace|bracelet|ring|watch|sunglasses|case|cover|phone case|hair clip)\b/i],
  ["gadgets", /\b(earbuds|headphones|speaker|charger|power bank|smartwatch|keyboard|mouse|camera|projector|gadget|usb|air quality monitor|smart device)\b/i],
  ["fitness", /\b(dumbbell|resistance band|yoga|fitness|gym|massager|workout|foam roller|posture corrector)\b/i],
  ["pets", /\b(pet|dog|cat|leash|collar|toy for dogs|toy for cats|pet bed|grooming brush|water bottle for dogs)\b/i],
  ["automotive", /\b(car|bike|motorcycle|dashboard|car mount|car cover|bike cover|phone holder|seat gap organizer)\b/i],
  ["kids", /\b(toy|kids|baby|infant|school bag|puzzle|stroller|educational toy)\b/i],
];

export function classifyProductQuery(query: string): { classification: ProductClassification; category: string; reason: string } {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return { classification: "AMBIGUOUS", category: "Unclassified", reason: "Empty trend query" };
  if (NON_PRODUCT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { classification: "NON_PRODUCT", category: "Non-product", reason: "Informational, event, media, finance, or news query" };
  }
  const match = PRODUCT_RULES.find(([, pattern]) => pattern.test(normalized));
  if (match) return { classification: "PRODUCT", category: match[0], reason: "Matched a commercial product/category intent rule" };
  if (/\b(buy|shop|price|deal|offer|best|top|cheap|under \d+|amazon|flipkart|review|reviews)\b/i.test(normalized)) {
    return { classification: "AMBIGUOUS", category: "Unclassified", reason: "Commercial intent detected but product identity is not yet specific" };
  }
  return { classification: "AMBIGUOUS", category: "Unclassified", reason: "Insufficient evidence to assert product intent" };
}
