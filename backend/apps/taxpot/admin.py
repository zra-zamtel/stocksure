from django.contrib import admin

from .models import SavingsTarget, SuggestionLog, TaxPotTransaction, Wallet

admin.site.register(Wallet)
admin.site.register(SavingsTarget)
admin.site.register(TaxPotTransaction)
admin.site.register(SuggestionLog)
