from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError

from apps.giftcards.models import GiftCardSubcategory


class Command(BaseCommand):
    help = (
        "Set the payout rate (GHS paid per 1 unit of the card's currency) on many subcategories at once.\n"
        "By default only fills subcategories that have NO rate yet; use --overwrite to replace existing ones.\n\n"
        "  set_giftcard_rates --currency USD --rate 12.0\n"
        "  set_giftcard_rates --brand apple --format ecode --rate 11.4 --overwrite\n"
        "  set_giftcard_rates --currency GBP --rate 15.5 --dry-run"
    )

    def add_arguments(self, parser):
        parser.add_argument("--rate", required=True, help="GHS per 1 unit of the card currency, e.g. 12.5")
        parser.add_argument("--currency", help="Only subcategories in this currency, e.g. USD")
        parser.add_argument("--brand", help="Only this brand (slug), e.g. amazon")
        parser.add_argument("--format", choices=["physical", "ecode", "any"], help="Only this card format")
        parser.add_argument("--overwrite", action="store_true", help="Also replace rates that are already set")
        parser.add_argument("--dry-run", action="store_true", help="Show what would change without saving")

    def handle(self, *args, **opts):
        try:
            rate = Decimal(opts["rate"])
        except InvalidOperation:
            raise CommandError("--rate must be a number.")
        if rate <= 0:
            raise CommandError("--rate must be greater than 0.")
        if not (opts["currency"] or opts["brand"] or opts["format"]):
            raise CommandError("Add at least one of --currency, --brand or --format so you don't reprice everything by accident.")

        qs = GiftCardSubcategory.objects.select_related("brand")
        if opts["currency"]:
            qs = qs.filter(currency=opts["currency"].upper())
        if opts["brand"]:
            qs = qs.filter(brand__slug=opts["brand"])
        if opts["format"]:
            qs = qs.filter(card_format=opts["format"])
        if not opts["overwrite"]:
            qs = qs.filter(rate__isnull=True)

        targets = list(qs)
        for s in targets:
            self.stdout.write(f"  {s.brand.name} — {s.name} ({s.currency}): {s.rate} -> {rate}")
            if not opts["dry_run"]:
                s.rate = rate
                s.save()
        verb = "Would set" if opts["dry_run"] else "Set"
        self.stdout.write(self.style.SUCCESS(f"{verb} the rate on {len(targets)} subcategory(ies)."))
