from django.urls import path

from . import views

urlpatterns = [
    path("config/", views.PaymentConfigView.as_view(), name="payments-config"),
    path("load/", views.LoadWalletView.as_view(), name="payments-load"),
    path("deposit-address/", views.DepositAddressView.as_view(), name="payments-deposit-address"),
    path("withdraw/", views.WithdrawView.as_view(), name="payments-withdraw"),
    path("transfers/lookup/", views.TransferLookupView.as_view(), name="payments-transfer-lookup"),
    path("transfers/", views.TransferView.as_view(), name="payments-transfer"),
    path("scheduled-transfers/", views.ScheduledTransferListCreateView.as_view(), name="payments-scheduled"),
    path("scheduled-transfers/<uuid:pk>/cancel/", views.ScheduledTransferCancelView.as_view(), name="payments-scheduled-cancel"),
    path("scheduled-loads/", views.ScheduledLoadListCreateView.as_view(), name="payments-scheduled-loads"),
    path("scheduled-loads/<uuid:pk>/cancel/", views.ScheduledLoadCancelView.as_view(), name="payments-scheduled-load-cancel"),
    path("scheduled-withdrawals/", views.ScheduledWithdrawalListCreateView.as_view(), name="payments-scheduled-withdrawals"),
    path("scheduled-withdrawals/<uuid:pk>/cancel/", views.ScheduledWithdrawalCancelView.as_view(), name="payments-scheduled-withdrawal-cancel"),
    path("destinations/", views.PayoutDestinationListCreateView.as_view(), name="payments-destinations"),
    path("destinations/<uuid:pk>/", views.PayoutDestinationDetailView.as_view(), name="payments-destination-detail"),
    path("payout-preference/", views.PayoutPreferenceView.as_view(), name="payments-payout-preference"),
]
