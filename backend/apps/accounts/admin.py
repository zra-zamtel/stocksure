from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.core.utils import validate_zm_phone

from .models import User


class UserCreateForm(forms.ModelForm):
    password1 = forms.CharField(label="PIN / password", widget=forms.PasswordInput)
    password2 = forms.CharField(label="Confirm", widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ("phone", "name", "role")

    def clean_phone(self):
        try:
            phone = validate_zm_phone(self.cleaned_data["phone"])
        except Exception:
            raise forms.ValidationError("Enter a valid Zambian phone number.")
        if User.objects.filter(phone=phone).exists():
            raise forms.ValidationError("This phone number is already registered.")
        return phone

    def clean(self):
        data = super().clean()
        if data.get("password1") != data.get("password2"):
            raise forms.ValidationError("The two entries do not match.")
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data["password1"])
        if commit:
            user.save()
        return user


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    add_form = UserCreateForm
    ordering = ("phone",)
    list_display = ("phone", "name", "role", "owner", "is_active", "is_staff")
    list_filter = ("role", "is_active")
    search_fields = ("phone", "name")
    fieldsets = (
        (None, {"fields": ("phone", "password")}),
        ("Profile", {"fields": ("name", "role", "owner", "client_id")}),
        ("Status", {"fields": ("is_active", "failed_pins", "locked_until")}),
        ("Admin site access", {"fields": ("is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("phone", "name", "role", "password1", "password2")}),)
