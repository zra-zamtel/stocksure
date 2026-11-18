from django.urls import path

from .views import SyncPullView, SyncPushView

urlpatterns = [
    path("sync/push", SyncPushView.as_view(), name="sync-push"),
    path("sync/push/", SyncPushView.as_view(), name="sync-push-slash"),
    path("sync/pull", SyncPullView.as_view(), name="sync-pull"),
    path("sync/pull/", SyncPullView.as_view(), name="sync-pull-slash"),
]
