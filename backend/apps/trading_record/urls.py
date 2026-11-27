from django.urls import path

from .views import TradingRecordListView, TradingRecordRevokeView

urlpatterns = [
    path("trading-records/", TradingRecordListView.as_view(), name="trading-records"),
    path("trading-records", TradingRecordListView.as_view(), name="trading-records-noslash"),
    path(
        "trading-records/<uuid:record_id>/revoke",
        TradingRecordRevokeView.as_view(),
        name="trading-record-revoke",
    ),
]
