"""The label lists Jev uses to tag each ad.

Edit the wording here to fit your market. Each `criteria` description is what Jev
reads to decide, so clearer descriptions give better tags. Jev reads the ad from
`state`, so questions say "the ad" / "the landing page" and never repeat the text.
"""

HOOK_TYPES = {
    "pain_problem": "Opens by calling out a problem, frustration, fear or mistake the reader has.",
    "desire_outcome": "Opens by promising a result, transformation or dream outcome.",
    "curiosity": "Opens with a tease, question, secret or open loop that makes you want to know more.",
    "social_proof": "Opens with numbers of customers, reviews, ratings or a testimonial.",
    "authority": "Opens with an expert, founder, credentials, awards or press mentions.",
    "offer_led": "Opens with the deal itself: a discount, price, free item or bonus.",
    "news_launch": "Opens by announcing something new: a launch, feature, batch or event.",
    "contrarian": "Opens by challenging a common belief or busting a myth.",
    "story": "Opens with a personal story or first-person experience.",
    "comparison": "Opens with before vs after, or us vs them.",
    "urgency_scarcity": "Opens with a deadline, limited seats, or a last chance.",
    "identity_callout": "Opens by naming who the ad is for, e.g. 'If you are a working professional...'.",
    "other": "None of the above fit.",
}

OFFER_TYPES = {
    "discount": "A percentage off, price cut, coupon code or sale price.",
    "free_trial": "Try the product free for a period.",
    "free_lead_magnet": "A free webinar, masterclass, ebook, guide, template, quiz or audit.",
    "free_consultation": "A free call, demo, counselling session or consultation.",
    "bundle_bonus": "Extra items, bonuses or gifts included with the purchase.",
    "guarantee": "The main offer is risk reversal: money-back, results guarantee or free returns.",
    "delivery_perk": "Free, fast or same-day delivery is the main incentive.",
    "app_install": "Download or install an app.",
    "full_price": "Sells the product at normal price with no special incentive.",
    "no_offer_brand": "Brand awareness or content with no offer at all.",
    "other": "None of the above fit.",
}

CTA_ASKS = {
    "buy_now": "Asks the reader to buy, shop, order or pay.",
    "register_event": "Asks the reader to register or book a seat for a webinar, masterclass, workshop or live event.",
    "sign_up": "Asks the reader to sign up, create an account, or enrol in a course or product (not an event).",
    "book_call": "Asks the reader to book a call, demo, consultation or counselling session.",
    "download_install": "Asks the reader to download a file or install an app.",
    "claim_offer": "Asks the reader to claim, grab or unlock a deal or free item.",
    "message_us": "Asks the reader to message on WhatsApp, Messenger, DM or call.",
    "learn_more": "Only asks the reader to learn more, read more or watch a video, with no firmer action.",
    "other": "None of the above fit.",
}

CREATIVE_FORMATS = {
    "problem_solution": "Shows a problem, then the product as the fix.",
    "offer_promo": "Built around a deal, sale, price or promo.",
    "product_announcement": "Launches or introduces a product, feature, course batch or collection.",
    "educational_howto": "Teaches something: tips, how-to, explainer, myth-busting or a list.",
    "testimonial_ugc": "A customer, creator or student talking about their experience, or a review.",
    "demo_showcase": "Shows the product being used or its features up close.",
    "lifestyle_aspiration": "Aspirational imagery of the life or look you get with the product.",
    "catalog_generic": "A plain product shot or catalog card with little message.",
    "brand_story": "About the brand, its founder, mission or behind the scenes.",
    "comparison": "Before vs after, or us vs them.",
    "meme_entertainment": "Humour, a meme, a trend or entertainment first.",
    "other": "None of the above fit.",
}

DRIVERS = {
    "price_value": "Saving money or getting good value.",
    "convenience_time": "Saving time or effort; fast, easy, simple.",
    "achievement_career": "Getting ahead: career, income, grades, skills, self-improvement.",
    "status_image": "Looking good, prestige, being seen a certain way.",
    "belonging": "Being part of a group, fandom, community or tradition.",
    "fear_safety": "Avoiding a risk, loss, mistake, embarrassment or health worry.",
    "health_wellbeing": "Feeling healthier, fitter, calmer or better.",
    "pleasure_indulgence": "Fun, taste, comfort or treating yourself.",
    "trust_quality": "Quality, reliability, expertise or authenticity.",
    "novelty_curiosity": "Something new, surprising or worth discovering.",
    "other": "None of the above fit.",
}

FUNNEL_STAGES = {
    "cold_prospecting": "Written for people who have never heard of the brand.",
    "mid_consideration": "Written for people already interested or comparing options.",
    "retargeting_close": "Written for people who know the brand, pushing them to act now.",
}

# 0-3 scales; Jev returns a probability for each level.
HOOK_SPECIFICITY = [
    "Generic: the opening could belong to any brand.",
    "Somewhat specific: names the category or the audience.",
    "Specific: a concrete detail, number or named situation.",
    "Very specific: vivid and unmistakable, with concrete numbers, audience and outcome.",
]
OFFER_STRENGTH = [
    "No offer at all.",
    "Weak: a generic benefit or 'shop now' with nothing extra.",
    "Clear: a concrete deal, free item or bonus.",
    "Irresistible: a big, specific, risk-free or time-limited deal.",
]
DURABILITY = [
    "Expires within days: tied to a date, sale end or event.",
    "Seasonal: tied to a season, festival or launch window.",
    "Long-lived: mostly evergreen with a few dated details.",
    "Evergreen: could run unchanged for months.",
]

# Eugene Schwartz's five stages of awareness, as an ordered scale (index 0..4).
AWARENESS_STAGES = [
    "Unaware: talks about the reader's life or situation without naming a problem or any product.",
    "Problem aware: names the reader's problem or pain, but not a type of solution.",
    "Solution aware: talks about a type of solution or method, not why this brand is the one.",
    "Product aware: talks about this brand's product, its features, proof, or why it is better.",
    "Most aware: leads with the deal, price or deadline, assuming the reader already knows the product.",
]
AWARENESS_LABELS = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"]

# Yes/no tags that can apply together. Each becomes one Jev "noul" question.
AD_TAGS = {
    "uses_specific_numbers": "The ad uses specific numbers or statistics (e.g. '10,000 students', '3x', '₹999').",
    "mentions_price": "The ad states a price or a price range.",
    "has_testimonial": "The ad quotes or shows a customer, review or testimonial.",
    "has_urgency": "The ad uses a deadline, countdown, limited seats or 'last chance'.",
    "has_guarantee": "The ad offers a guarantee, refund or other risk reversal.",
    "targets_specific_audience": "The ad names a specific audience, job, age group or situation.",
}

LANDING_PAGE_MATCH = [
    "Unrelated: the page is about a different product or topic than the ad.",
    "Same brand, different offer: the page sells something other than what the ad promised.",
    "Same product, details differ: the price, terms or what is free differ from the ad.",
    "Matches: the page delivers the same product and offer the ad promised.",
]
LANDING_PAGE_MATCH_LABELS = ["unrelated", "different_offer", "details_differ", "matches"]


def ad_questions() -> dict:
    q = {
        "hook_type": {
            "type": "choice",
            "instructions": "What kind of hook does the ad open with? Judge only the opening: the first line of the ad copy, the headline, and any big text on the creative.",
            "criteria": HOOK_TYPES,
        },
        "offer_type": {
            "type": "choice",
            "instructions": "What is the main offer the ad makes to the reader?",
            "criteria": OFFER_TYPES,
        },
        "cta_ask": {
            "type": "choice",
            "instructions": "What action does the ad ask the reader to take? Use the ad copy, not only the button label.",
            "criteria": CTA_ASKS,
        },
        "awareness_stage": {
            "type": "score",
            "instructions": "Which stage of awareness is the ad written for?",
            "criteria": AWARENESS_STAGES,
        },
        "creative_format": {
            "type": "choice",
            "instructions": "What creative format is the ad built as? Use the creative and the copy together.",
            "criteria": CREATIVE_FORMATS,
        },
        "driver": {
            "type": "choice",
            "instructions": "What main motivation does the ad appeal to?",
            "criteria": DRIVERS,
        },
        "funnel": {
            "type": "choice",
            "instructions": "Which part of the funnel is the ad written for?",
            "criteria": FUNNEL_STAGES,
        },
        "hook_specificity": {
            "type": "score",
            "instructions": "How specific is the ad's opening hook?",
            "criteria": HOOK_SPECIFICITY,
        },
        "offer_strength": {
            "type": "score",
            "instructions": "How strong is the ad's offer?",
            "criteria": OFFER_STRENGTH,
        },
        "durability": {
            "type": "score",
            "instructions": "How long could this ad keep running before it goes stale?",
            "criteria": DURABILITY,
        },
        "claim_risk": {
            "type": "noul",
            "instructions": "The ad makes a bold claim that would need proof or could break ad rules: guaranteed results, health or medical claims, income claims, 'best/No.1', or dramatic before/after.",
        },
    }
    for tag, statement in AD_TAGS.items():
        q[f"tag_{tag}"] = {"type": "noul", "instructions": statement}
    return q


def landing_page_questions() -> dict:
    return {
        "lp_match": {
            "type": "score",
            "instructions": "How well does the landing page deliver what the ad promised?",
            "criteria": LANDING_PAGE_MATCH,
        },
        "lp_same_offer": {
            "type": "noul",
            "instructions": "The landing page offers the same thing the ad promises, on the same terms.",
        },
        "lp_free_to_paid": {
            "type": "noul",
            "instructions": "The ad promises something free, but the landing page asks for payment, a subscription or card details.",
        },
        "lp_headline_continues_hook": {
            "type": "noul",
            "instructions": "The landing page's main headline continues the same message or promise as the ad's opening.",
        },
    }
