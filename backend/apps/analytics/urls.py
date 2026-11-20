from django.urls import path

from .views import AdminOverviewView, OwnerDashboardView

urlpatterns = [
    path("dashboard/", OwnerDashboardView.as_view(), name="dashboard"),
    path("admin-overview/", AdminOverviewView.as_view(), name="admin-overview"),
]
