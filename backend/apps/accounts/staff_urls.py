from django.urls import path

from .views import StaffDeactivateView, StaffListCreateView, StaffResetPinView

urlpatterns = [
    path("staff", StaffListCreateView.as_view(), name="staff"),
    path("staff/<str:staff_id>/reset-pin", StaffResetPinView.as_view(), name="staff-reset-pin"),
    path("staff/<str:staff_id>/deactivate", StaffDeactivateView.as_view(), name="staff-deactivate"),
]
