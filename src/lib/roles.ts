/**
 * Library of teammate role templates. The team designer picks from and customizes
 * these rather than inventing roles from scratch, which keeps teams reliable.
 */
export type RoleTemplate = {
  key: string;
  title: string;
  color: string;
  summary: string;
  /** Default instructions; the designer adds business-specific persona text. */
  instructions: string;
  defaultKpis: string[];
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "growth_lead",
    title: "Growth Lead",
    color: "#f59e0b",
    summary: "Owns the growth plan, sets weekly priorities, delegates to the team and reports progress.",
    instructions:
      "You coordinate the team. Turn the business goals into a weekly plan, break it into concrete tasks and delegate them to teammates with assign_task. Review what the team produced and write a short progress report for the owner.",
    defaultKpis: ["Weekly plan delivered", "Goals on track"],
  },
  {
    key: "content_marketer",
    title: "Content Marketer",
    color: "#ec4899",
    summary: "Writes blog posts, newsletters and website copy that attract the target customers.",
    instructions:
      "You create high-quality written content in the brand voice: blog posts, product descriptions, newsletters and landing-page copy. Research topics before writing. Save every piece with save_deliverable.",
    defaultKpis: ["Pieces published per week", "Organic traffic"],
  },
  {
    key: "social_media_manager",
    title: "Social Media Manager",
    color: "#8b5cf6",
    summary: "Plans and drafts social posts, captions and content calendars for each channel.",
    instructions:
      "You run the social channels. Plan content calendars, write captions with hashtags, suggest visuals, and adapt each post to its channel. Save every post with save_deliverable.",
    defaultKpis: ["Posts per week", "Engagement rate", "Follower growth"],
  },
  {
    key: "seo_specialist",
    title: "SEO Specialist",
    color: "#10b981",
    summary: "Audits the website, finds keywords and recommends on-page and content improvements.",
    instructions:
      "You improve search visibility. Audit pages of the website with WebFetch, research keywords and competitors with WebSearch, and produce prioritized, specific recommendations and content briefs.",
    defaultKpis: ["Keywords ranking", "Organic sessions"],
  },
  {
    key: "market_researcher",
    title: "Market Researcher",
    color: "#06b6d4",
    summary: "Researches customers, competitors, trends and opportunities.",
    instructions:
      "You research the market: competitors, pricing, customer segments, trends, communities and partnership or marketplace opportunities. Cite sources and end with clear recommendations.",
    defaultKpis: ["Insights delivered", "Opportunities found"],
  },
  {
    key: "sales_outreach",
    title: "Sales & Partnerships",
    color: "#3b82f6",
    summary: "Finds leads, wholesale and partnership prospects and drafts outreach.",
    instructions:
      "You grow revenue through outreach. Find prospective customers, retailers, collaborators or influencers that fit the business, and draft personalized outreach messages. Never contact anyone without approval.",
    defaultKpis: ["Qualified leads per week", "Replies", "Deals"],
  },
  {
    key: "customer_support",
    title: "Customer Success",
    color: "#ef4444",
    summary: "Drafts FAQs, reply templates and improves the customer experience.",
    instructions:
      "You care for customers. Write FAQs, reply templates and help content, and suggest improvements to the purchase and post-purchase experience.",
    defaultKpis: ["Response time", "Customer satisfaction"],
  },
  {
    key: "ads_specialist",
    title: "Ads Specialist",
    color: "#84cc16",
    summary: "Plans paid campaigns and writes ad copy and audience targeting.",
    instructions:
      "You plan paid acquisition: campaign structure, audiences, budgets and ad copy variants for platforms such as Meta, Google and marketplaces. Never spend money; propose plans for approval.",
    defaultKpis: ["Cost per acquisition", "Return on ad spend"],
  },
];

export function getRole(key: string) {
  return ROLE_TEMPLATES.find((r) => r.key === key);
}
