"""TaxMate: answers come ONLY from reviewed content. There is deliberately no free-text generation,
so the assistant cannot invent a tax rule. Matching is simple keyword scoring that runs offline."""
import re

from apps.tax.models import DISCLAIMER

from .models import DEFAULT_OFFICIAL_CHANNEL, ReviewedAnswer

STOPWORDS = {
    "a", "an", "the", "is", "are", "do", "does", "i", "my", "me", "we", "our", "you", "your", "to", "of",
    "for", "in", "on", "and", "or", "it", "this", "that", "what", "how", "when", "can", "should", "will",
    "be", "by", "with", "about", "if", "as", "at", "so", "need", "have", "get",
}
ANSWER_SCORE = 3
RELATED_SCORE = 2

NO_ANSWER = (
    "I do not have a reviewed answer for that yet. Please ask ZRA directly, or try one of the topics below."
)


def tokens(text):
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if t not in STOPWORDS and len(t) > 1}


def score(q_tokens, answer):
    kw = tokens(answer.keywords)
    qt = tokens(answer.question)
    # Keywords count double: they are written for matching.
    return 2 * len(q_tokens & kw) + len(q_tokens & qt)


def ask(question, language="en"):
    q = tokens(question)
    candidates = ReviewedAnswer.objects.filter(is_reviewed=True)
    scored = sorted(((score(q, a), a) for a in candidates), key=lambda x: -x[0])
    best_score, best = scored[0] if scored else (0, None)

    base = {"disclaimer": DISCLAIMER, "official_channel": DEFAULT_OFFICIAL_CHANNEL}
    if best is None or best_score < ANSWER_SCORE:
        topics = [a for s, a in scored if s > 0][:3] or list(candidates[:5])
        return None, 0, {
            **base, "answered": False, "answer": NO_ANSWER,
            "suggested_topics": [{"id": a.id, "question": a.question} for a in topics],
        }
    use_ny = language == "ny" and bool(best.answer_ny)
    related = [a for s, a in scored[1:4] if s >= RELATED_SCORE]
    note = ""
    if language == "ny" and not use_ny:
        note = "The Nyanja version of this answer has not been reviewed yet, so it is shown in English."
    return best, best_score, {
        **base, "answered": True, "id": best.id, "category": best.category, "question": best.question,
        "answer": best.answer_ny if use_ny else best.answer_en,
        "language": "ny" if use_ny else "en", "language_note": note,
        "reviewed_on": best.reviewed_on, "official_channel": best.official_channel,
        "type": "general guidance, not official tax advice",
        "related": [{"id": a.id, "question": a.question} for a in related],
    }


def explain_estimate(estimate):
    """Plain-language explanation of an estimate and its assumptions (built from the stored figures)."""
    lines = [
        f"For {estimate.period_start:%d %b %Y} to {estimate.period_end:%d %b %Y} your recorded income was "
        f"K{estimate.verified_income + estimate.reported_income:,.2f}.",
        f"K{estimate.verified_income:,.2f} of it is verified (confirmed by matched mobile-money payments or a "
        f"balanced daily close). K{estimate.reported_income:,.2f} is trader-reported.",
        f"The estimate uses {estimate.rate_percent.normalize():f}% of K{estimate.basis_income:,.2f}, "
        f"which gives about K{estimate.estimated_tax:,.2f}.",
        f"It follows the rule set '{estimate.rule_set.name}' version {estimate.rule_set.version}.",
    ]
    if not estimate.rules_validated:
        lines.append("These rules have not been validated with ZRA yet, so please do not rely on the number.")
    lines.append("This is an estimate to help you plan and save. It is not a ZRA assessment.")
    return {
        "summary": " ".join(lines), "points": lines, "assumptions": estimate.assumptions,
        "warnings": estimate.warnings, "disclaimer": DISCLAIMER, "official_channel": DEFAULT_OFFICIAL_CHANNEL,
    }
