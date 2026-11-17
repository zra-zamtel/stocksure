from datetime import date

from django.core.management.base import BaseCommand

from apps.taxmate.models import ReviewedAnswer

# General guidance only. No rates, limits or dates are quoted: those must come from ZRA.
CONTENT = [
    ("concepts", "What is turnover tax?",
     "turnover, tax, small business, simplified, what is",
     "Turnover tax is a simplified way for small businesses to pay tax. It is worked out from your total sales "
     "(your turnover) over a period, rather than from your profit. The rate, the turnover limit and the due dates "
     "are set by ZRA and can change, so confirm the current ones with ZRA before relying on any figure."),
    ("records", "Why should I keep records of my sales and expenses?",
     "records, books, sales book, keep records, expenses, why",
     "Clear records show how your business is really doing, help you understand which tax obligations apply to you, "
     "and let you prepare early instead of searching for the numbers near the due date. They also help when you talk "
     "to a bank or supplier about financing."),
    ("tpin", "What is a TPIN?",
     "tpin, taxpayer, identification, number, what is",
     "TPIN stands for Taxpayer Identification Number. ZRA issues it to identify you for tax. You need it to deal with "
     "ZRA, for example when registering for a tax, filing a return or making a payment."),
    ("registration", "How do I register for tax and get a TPIN?",
     "register, registration, tpin, apply, how, get tpin, sign up",
     "In general you register with ZRA, either through its online portal or at a ZRA office, using your identity "
     "documents and details of your business. Requirements and steps can change, so confirm the current steps and "
     "documents with ZRA before you go."),
    ("obligations", "When is my tax due?",
     "due date, deadline, when, pay, filing, due",
     "Due dates are set by ZRA and depend on the type of tax and how you are registered. StockSure can remind you "
     "before a date you enter, but always confirm the official date with ZRA."),
    ("obligations", "Is the StockSure estimate the amount I must pay?",
     "estimate, assessment, amount, must pay, official, stocksure, how much",
     "No. The StockSure figure is an estimate from your recorded sales, shown with the rules and period it used. "
     "It helps you plan and save. It is not an official ZRA assessment. Confirm what you owe with ZRA."),
    ("savings", "Why should I set money aside for tax?",
     "save, savings, set aside, taxpot, wallet, why, tax money",
     "Setting aside a little regularly means the money is ready when the tax is due, instead of finding a large amount "
     "at the last minute. In StockSure the TaxPot target can be your estimated tax, and you can accept, change or skip "
     "each suggested amount. In this prototype the wallet is simulated and holds no real money."),
    ("stocksure", "What does verified mean in my ledger?",
     "verified, trader reported, ledger, confirmed, meaning",
     "Verified means the sale was confirmed by a matched mobile-money payment or by a daily cash count with no gap. "
     "Trader-reported means it was typed in by hand or is not yet confirmed. Verified records make your tax estimate "
     "more reliable."),
]


class Command(BaseCommand):
    help = (
        "Load starter TaxMate content (general guidance, no figures). It is saved as NOT reviewed, so TaxMate "
        "will not serve it until a person reviews it in the admin. Use --mark-reviewed only for local demos."
    )

    def add_arguments(self, parser):
        parser.add_argument("--mark-reviewed", action="store_true", help="DEMO ONLY: mark all as reviewed.")

    def handle(self, *args, **opts):
        n = 0
        for category, question, keywords, answer in CONTENT:
            obj, created = ReviewedAnswer.objects.get_or_create(
                question=question, defaults={"category": category, "keywords": keywords, "answer_en": answer}
            )
            n += created
            if opts["mark_reviewed"]:
                obj.is_reviewed, obj.reviewed_by, obj.reviewed_on = True, "DEMO (not a real review)", date.today()
                obj.save()
        self.stdout.write(self.style.SUCCESS(f"{n} new answer(s) added."))
        if opts["mark_reviewed"]:
            self.stdout.write(self.style.WARNING("Marked as reviewed for DEMO only. Have them genuinely reviewed before any pilot."))
        else:
            self.stdout.write("Not reviewed yet: open /admin/ -> Reviewed answers and review them.")
