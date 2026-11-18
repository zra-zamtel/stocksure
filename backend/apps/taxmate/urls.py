from django.urls import path

from .views import AnswerDetailView, AskView, ExplainEstimateView, TopicsView

urlpatterns = [
    path("taxmate/ask/", AskView.as_view(), name="taxmate-ask"),
    path("taxmate/topics/", TopicsView.as_view(), name="taxmate-topics"),
    path("taxmate/answers/<int:pk>/", AnswerDetailView.as_view(), name="taxmate-answer"),
    path("taxmate/explain-estimate/<int:pk>/", ExplainEstimateView.as_view(), name="taxmate-explain"),
]
