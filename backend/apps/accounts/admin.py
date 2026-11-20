from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.core.utils import validate_zm_phone

from .models import User


class UserCreateForm(forms.ModelForm):
    password1 = forms.CharField(label="Password / PIN", widget=forms.PasswordInput)
    password2 = forms.CharField(label="Confirm", widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ("phone", "full_name")

    def clean_phone(self):
        phone = validate_zm_phone(self.cleaned_data["phone"])
        if User.objects.filter(phone=phone).exists():
            raise forms.ValidationError("This phone number is already registered.")
        return phone

    def clean(self):
        data = super().clean()
        if data.get("password1") != data.get("password2"):
            raise forms.ValidationError("The two passwords do not match.")
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
    list_display = ("phone", "full_name", "is_staff", "is_active")
    search_fields = ("phone", "full_name")
    fieldsets = (
        (None, {"fields": ("phone", "password")}),
        ("Profile", {"fields": ("full_name", "email", "language")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "full_name", "password1", "password2")}),
    )
