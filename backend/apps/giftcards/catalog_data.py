"""
The gift card catalog: which brands can be sold, and their subcategories.

WHERE THIS COMES FROM
Compiled from what the main Nigeria/Ghana exchanges (Cardtonic, Nosh, Sogo,
Apexpay, Prestmit, and others) publicly list as sellable, plus each brand's own
region/currency rules (e.g. Steam wallet codes are locked to a currency, Amazon
cards only work on their home marketplace, Razer Gold wallets are regional).

THIS IS NOT "EVERY GIFT CARD IN THE WORLD"
No such list exists — one exchange advertises 14,000+ purchasable cards, but the
set people actually SELL is a few dozen brands. This is the set that shows up
consistently. Add more in Django admin (Gift cards -> Brands / Subcategories);
no code change or deploy is needed.

RATES ARE DELIBERATELY NOT SEEDED
A subcategory with no rate is shown to sellers as unavailable. Prices are a
business decision that moves daily, so set them yourself:
    python manage.py set_giftcard_rates --currency USD --rate 12.0
or edit the "Rate" column in Django admin -> Gift card subcategories.

HOW SYNC WORKS
`sync_catalog` only CREATES what's missing. It never overwrites a rate, an
active/inactive switch, or a name you've edited — so re-running it after adding
new entries here is safe.
"""

PHYS, ECODE, ANY = "physical", "ecode", "any"

# (slug, label, ISO country / EU / GLOBAL, currency)
USA = ("usa", "USA", "US", "USD")
UK = ("uk", "UK", "GB", "GBP")
CANADA = ("canada", "Canada", "CA", "CAD")
AUSTRALIA = ("australia", "Australia", "AU", "AUD")
EUROPE = ("europe", "Europe", "EU", "EUR")
GERMANY = ("germany", "Germany", "DE", "EUR")
FRANCE = ("france", "France", "FR", "EUR")
ITALY = ("italy", "Italy", "IT", "EUR")
SPAIN = ("spain", "Spain", "ES", "EUR")
JAPAN = ("japan", "Japan", "JP", "JPY")
MEXICO = ("mexico", "Mexico", "MX", "MXN")
BRAZIL = ("brazil", "Brazil", "BR", "BRL")
UAE = ("uae", "UAE", "AE", "AED")
SAUDI = ("saudi-arabia", "Saudi Arabia", "SA", "SAR")
POLAND = ("poland", "Poland", "PL", "PLN")
SWITZERLAND = ("switzerland", "Switzerland", "CH", "CHF")
GLOBAL_USD = ("global", "Global", "GLOBAL", "USD")

_FORMAT_LABEL = {PHYS: "Physical", ECODE: "E-code"}
_FORMAT_SLUG = {PHYS: "physical", ECODE: "ecode"}


def sub(region, fmt=ANY, *, label=None, slug=None, min_value=None, max_value=None, auto=True, help="", currency=None):
    """One subcategory. `fmt` ANY produces a single "Region" entry; PHYS/ECODE add a suffix."""
    r_slug, r_label, country, r_currency = region
    name = label or r_label
    if fmt in _FORMAT_LABEL and not label:
        name = f"{r_label} · {_FORMAT_LABEL[fmt]}"
    return {
        "slug": slug or (r_slug if fmt == ANY else f"{r_slug}-{_FORMAT_SLUG[fmt]}"),
        "name": name,
        "country": country,
        "currency": currency or r_currency,
        "card_format": fmt,
        "min_value": min_value,
        "max_value": max_value,
        "allow_auto_payment": auto,
        "help_text": help,
    }


def both(region, **kw):
    """Physical AND e-code entries for a region (they are priced differently)."""
    return [sub(region, PHYS, **kw), sub(region, ECODE, **kw)]


def open_loop(region=USA):
    """Open-loop prepaid cards: with / without the activation receipt. Manual settlement only."""
    note = "The activation receipt isn't required, but including it helps verification."
    return [
        sub(region, ANY, label=f"{region[1]} · With receipt", slug=f"{region[0]}-with-receipt", auto=False, help=note),
        sub(region, ANY, label=f"{region[1]} · No receipt", slug=f"{region[0]}-no-receipt", auto=False, help=note),
    ]


_EU_NOTE = "Euro cards from Germany, France, Spain, Italy, Ireland, Netherlands, etc. Check the country on the card."

# fmt: off
CATALOG = [
    # ---------------------------------------------------------------- SHOPPING
    {"slug": "amazon", "sort": 10, "name": "Amazon", "category": "shopping", "colors": ("#232f3e", "#37475a"), "subs": [
        *both(USA), *both(UK), sub(CANADA), sub(AUSTRALIA), sub(GERMANY), sub(FRANCE), sub(ITALY), sub(SPAIN),
        sub(JAPAN), sub(UAE),
    ]},
    {"slug": "walmart", "sort": 80, "name": "Walmart", "category": "shopping", "colors": ("#004c91", "#0071ce"), "subs": [*both(USA)]},
    {"slug": "target", "sort": 90, "name": "Target", "category": "shopping", "colors": ("#a90000", "#cc0000"), "subs": [*both(USA)]},
    {"slug": "ebay", "sort": 100, "name": "eBay", "category": "shopping", "colors": ("#3665a3", "#86b817"), "subs": [
        *both(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(GERMANY),
    ]},
    {"slug": "best_buy", "name": "Best Buy", "category": "shopping", "colors": ("#0a4abf", "#f5d30f"), "subs": [*both(USA), sub(CANADA)]},
    {"slug": "home_depot", "name": "Home Depot", "category": "shopping", "colors": ("#c2410c", "#f96302"), "subs": [*both(USA)]},
    {"slug": "macys", "name": "Macy's", "category": "shopping", "colors": ("#8b1a1a", "#e21a2c"), "subs": [*both(USA)]},
    {"slug": "nordstrom", "name": "Nordstrom", "category": "shopping", "colors": ("#1f2937", "#4b5563"), "subs": [*both(USA)]},
    {"slug": "jcpenney", "name": "JCPenney", "category": "shopping", "colors": ("#9f1239", "#e11d48"), "subs": [sub(USA)]},
    {"slug": "kohls", "name": "Kohl's", "category": "shopping", "colors": ("#111827", "#6d28d9"), "subs": [sub(USA)]},

    # ------------------------------------------------------------------ GAMING
    {"slug": "steam", "sort": 40, "name": "Steam", "category": "gaming", "colors": ("#171a21", "#2a475e"), "subs": [
        # Steam wallet codes are locked to the currency printed on them — so currency IS the subcategory.
        *both(USA), sub(UK), sub(EUROPE, help=_EU_NOTE), sub(CANADA), sub(AUSTRALIA), sub(JAPAN), sub(MEXICO), sub(BRAZIL),
    ]},
    {"slug": "playstation", "sort": 50, "name": "PlayStation", "category": "gaming", "colors": ("#003791", "#0057e2"), "subs": [
        # PSN wallets are regional: the card must match the store country of the account.
        *both(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(EUROPE, help=_EU_NOTE), sub(SAUDI), sub(UAE),
        sub(JAPAN), sub(POLAND),
    ]},
    {"slug": "xbox", "sort": 60, "name": "Xbox", "category": "gaming", "colors": ("#0e7a0d", "#107c10"), "subs": [
        *both(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(EUROPE, help=_EU_NOTE),
    ]},
    {"slug": "razer_gold", "sort": 70, "name": "Razer Gold", "category": "gaming", "colors": ("#111111", "#2a2a2a"), "subs": [
        # Razer wallets are regional; "Global" (USD) only works on an "Other"-region wallet.
        sub(GLOBAL_USD, help='Global (USD) codes only work on a Razer Gold wallet set to the "Other" region.'),
        sub(USA), sub(EUROPE, help=_EU_NOTE), sub(UK), sub(CANADA), sub(AUSTRALIA),
        sub(("malaysia", "Malaysia", "MY", "MYR")), sub(("singapore", "Singapore", "SG", "SGD")),
        sub(("india", "India", "IN", "INR")), sub(BRAZIL), sub(MEXICO), sub(("turkey", "Turkey", "TR", "TRY")),
        sub(JAPAN), sub(("hong-kong", "Hong Kong", "HK", "HKD")), sub(("indonesia", "Indonesia", "ID", "IDR")),
        sub(("philippines", "Philippines", "PH", "PHP")), sub(("thailand", "Thailand", "TH", "THB")),
        sub(("new-zealand", "New Zealand", "NZ", "NZD")),
    ]},
    {"slug": "roblox", "name": "Roblox", "category": "gaming", "colors": ("#1f2933", "#e2231a"), "subs": [
        *both(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(EUROPE, help=_EU_NOTE),
    ]},
    {"slug": "nintendo", "name": "Nintendo eShop", "category": "gaming", "colors": ("#8b0000", "#e60012"), "subs": [
        sub(USA), sub(CANADA), sub(UK), sub(EUROPE, help=_EU_NOTE), sub(AUSTRALIA), sub(JAPAN),
    ]},
    {"slug": "gamestop", "name": "GameStop", "category": "gaming", "colors": ("#1a1a1a", "#c8102e"), "subs": [*both(USA), sub(CANADA)]},
    {"slug": "g2a", "name": "G2A", "category": "gaming", "colors": ("#1b1b1b", "#f05a28"), "subs": [
        sub(GLOBAL_USD), sub(EUROPE, help=_EU_NOTE),
    ]},
    {"slug": "offgamers", "name": "OffGamers", "category": "gaming", "colors": ("#0f172a", "#2563eb"), "subs": [sub(GLOBAL_USD)]},

    # ------------------------------------------------------ APPS & ENTERTAINMENT
    {"slug": "apple", "sort": 20, "name": "Apple / iTunes", "category": "apps_entertainment", "colors": ("#1d1d1f", "#3a3a3c"), "subs": [
        # Exchanges price the card LAYOUT differently, so it's a subcategory in its own right.
        sub(USA, PHYS, label="USA · Physical (horizontal)", slug="usa-physical-horizontal",
            help="Landscape card. Usually the best rate."),
        sub(USA, PHYS, label="USA · Physical (vertical)", slug="usa-physical-vertical", help="Portrait card."),
        sub(USA, ECODE),
        sub(USA, ANY, label="USA · Code only (no photo)", slug="usa-code-only",
            help="You only have the code, with no photo of the card. Usually the lowest rate."),
        sub(UK, PHYS), sub(UK, ECODE), sub(CANADA), sub(AUSTRALIA),
        sub(EUROPE, help="Euro cards from Germany, Ireland, Finland, Greece, etc."), sub(SWITZERLAND),
    ]},
    {"slug": "apple_store", "name": "Apple Store", "category": "apps_entertainment", "colors": ("#0f0f10", "#6e6e73"), "subs": [
        *both(USA), sub(UK),
    ]},
    {"slug": "google_play", "sort": 30, "name": "Google Play", "category": "apps_entertainment", "colors": ("#01875f", "#4285f4"), "subs": [
        *both(USA), sub(UK), sub(CANADA, help="Canadian cards are printed in English and French."), sub(AUSTRALIA),
        sub(GERMANY), sub(("europe-other", "Europe (other)", "EU", "EUR"), help=_EU_NOTE), sub(MEXICO),
    ]},
    {"slug": "netflix", "name": "Netflix", "category": "apps_entertainment", "colors": ("#141414", "#e50914"), "subs": [
        sub(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(EUROPE, help=_EU_NOTE),
    ]},
    {"slug": "spotify", "name": "Spotify", "category": "apps_entertainment", "colors": ("#121212", "#1db954"), "subs": [
        sub(USA), sub(UK), sub(CANADA), sub(AUSTRALIA), sub(EUROPE, help=_EU_NOTE),
    ]},

    # ------------------------------------------------------------ FASHION & BEAUTY
    {"slug": "nike", "sort": 110, "name": "Nike", "category": "fashion_beauty", "colors": ("#111111", "#333333"), "subs": [*both(USA), sub(UK)]},
    {"slug": "adidas", "name": "Adidas", "category": "fashion_beauty", "colors": ("#000000", "#3d3d3d"), "subs": [sub(USA)]},
    {"slug": "foot_locker", "name": "Foot Locker", "category": "fashion_beauty", "colors": ("#1a1a1a", "#7f7f7f"), "subs": [*both(USA), sub(CANADA)]},
    {"slug": "sephora", "name": "Sephora", "category": "fashion_beauty", "colors": ("#111111", "#5c5c5c"), "subs": [*both(USA), sub(CANADA)]},
    {"slug": "lululemon", "name": "lululemon", "category": "fashion_beauty", "colors": ("#7f1d1d", "#d31f3a"), "subs": [sub(USA)]},
    {"slug": "coach", "name": "Coach", "category": "fashion_beauty", "colors": ("#3b2a1a", "#8a5a2b"), "subs": [sub(USA)]},

    # --------------------------------------------------------------- FOOD & TRAVEL
    {"slug": "uber", "name": "Uber", "category": "food_travel", "colors": ("#000000", "#276ef1"), "subs": [sub(USA), sub(CANADA), sub(UK)]},
    {"slug": "airbnb", "name": "Airbnb", "category": "food_travel", "colors": ("#b91c3c", "#ff5a5f"), "subs": [sub(USA), sub(UK)]},
    {"slug": "hotels_com", "name": "Hotels.com", "category": "food_travel", "colors": ("#7a1f1f", "#d32f2f"), "subs": [sub(USA)]},
    {"slug": "starbucks", "name": "Starbucks", "category": "food_travel", "colors": ("#0b3d2e", "#00704a"), "subs": [*both(USA), sub(CANADA)]},
    {"slug": "chipotle", "name": "Chipotle", "category": "food_travel", "colors": ("#451a03", "#a81612"), "subs": [sub(USA)]},

    # ------------------------------------------------------------ PREPAID (OPEN-LOOP)
    # These work like cash anywhere a card is accepted, which makes them the most fraud-prone
    # cards to buy. They are NEVER auto-credited or auto-paid-out (auto=False): an admin
    # must review and settle each one by hand.
    {"slug": "vanilla", "name": "Vanilla / OneVanilla", "category": "prepaid", "colors": ("#7c2d12", "#ea580c"), "subs": [
        # Priced by value band. The activation receipt is optional but helps.
        sub(USA, ANY, label="USA · Visa/Mastercard · up to $99.99", slug="usa-1-99", min_value=1, max_value=99.99, auto=False,
            help="OneVanilla / MyVanilla Visa or Mastercard. An activation receipt helps but isn't required."),
        sub(USA, ANY, label="USA · Visa/Mastercard · $100–$299.99", slug="usa-100-299", min_value=100, max_value=299.99, auto=False,
            help="OneVanilla / MyVanilla Visa or Mastercard. An activation receipt helps but isn't required."),
        sub(USA, ANY, label="USA · Visa/Mastercard · $300–$500", slug="usa-300-500", min_value=300, max_value=500, auto=False,
            help="OneVanilla / MyVanilla Visa or Mastercard. An activation receipt helps but isn't required."),
    ]},
    {"slug": "visa", "name": "Visa gift card", "category": "prepaid", "colors": ("#1a1f71", "#3b5bdb"), "subs": open_loop()},
    {"slug": "mastercard", "name": "Mastercard gift card", "category": "prepaid", "colors": ("#7f1d1d", "#f97316"), "subs": open_loop()},
    {"slug": "amex", "name": "American Express", "category": "prepaid", "colors": ("#006fcf", "#4aa3e8"), "subs": open_loop()},
    {"slug": "walmart_visa", "name": "Walmart Visa", "category": "prepaid", "colors": ("#004c91", "#f2b705"), "subs": open_loop()},
    {"slug": "target_visa", "name": "Target Visa", "category": "prepaid", "colors": ("#8a0000", "#cc0000"), "subs": open_loop()},
    {"slug": "netspend", "name": "Netspend", "category": "prepaid", "colors": ("#0f766e", "#14b8a6"), "subs": [sub(USA, auto=False)]},
    {"slug": "green_dot", "name": "Green Dot", "category": "prepaid", "colors": ("#14532d", "#22c55e"), "subs": [sub(USA, auto=False)]},
]
# fmt: on


def sync_catalog(Brand, Subcategory) -> dict:
    """
    Create any brand / subcategory in CATALOG that doesn't exist yet. Existing rows are
    left exactly as they are (rates, switches and edits made in admin are never touched).
    Takes the model classes as arguments so a migration can pass its historical models.
    """
    created_brands = created_subs = 0
    for b_index, brand in enumerate(CATALOG):
        color_from, color_to = brand["colors"]
        brand_obj, made = Brand.objects.get_or_create(
            slug=brand["slug"],
            defaults={
                "name": brand["name"],
                "category": brand["category"],
                "color_from": color_from,
                "color_to": color_to,
                # The most-traded brands are pinned to the front ("sort"); the rest follow in catalog order.
                "sort_order": brand.get("sort") or (200 + b_index * 10),
            },
        )
        created_brands += int(made)
        for s_index, s in enumerate(brand["subs"]):
            _, made = Subcategory.objects.get_or_create(
                brand=brand_obj,
                slug=s["slug"],
                defaults={**{k: v for k, v in s.items() if k != "slug"}, "sort_order": (s_index + 1) * 10},
            )
            created_subs += int(made)
    return {"brands": created_brands, "subcategories": created_subs}
