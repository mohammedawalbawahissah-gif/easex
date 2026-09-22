from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.payments.services import credit_crypto_deposit


class Command(BaseCommand):
    help = "DEV ONLY: credit a fake on-chain deposit so the wallet can be tested without a crypto provider."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("currency")
        parser.add_argument("amount")

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("simulate_deposit only runs with DEBUG=True.")
        User = get_user_model()
        try:
            user = User.objects.get(username=opts["username"])
        except User.DoesNotExist:
            raise CommandError("No such user.")
        import uuid

        txn = credit_crypto_deposit(
            user=user,
            currency=opts["currency"].upper(),
            amount=opts["amount"],
            network="simulated",
            tx_hash=f"sim-{uuid.uuid4().hex[:16]}",
        )
        self.stdout.write(self.style.SUCCESS(f"Credited {txn.amount} {txn.currency} to {user.username}"))
