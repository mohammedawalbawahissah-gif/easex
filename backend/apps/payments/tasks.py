from celery import shared_task

from . import services


@shared_task
def execute_withdrawal(txn_id):
    """Send one approved withdrawal through the payment provider."""
    services.execute_withdrawal(txn_id)


@shared_task
def process_due_scheduled_transfers():
    """Beat task (every minute): run scheduled transfers whose time has come."""
    return services.run_due_scheduled_transfers()


@shared_task
def process_due_scheduled_loads():
    """Beat task (every minute): run scheduled wallet loads whose time has come."""
    return services.run_due_scheduled_loads()


@shared_task
def process_due_scheduled_withdrawals():
    """Beat task (every minute): run scheduled withdrawals whose time has come."""
    return services.run_due_scheduled_withdrawals()


@shared_task
def dispatch_stuck_withdrawals():
    """Beat task (every few minutes): re-queue approved withdrawals that were never sent to the provider."""
    return services.dispatch_stuck_withdrawals()
