import {
  expect,
  PASSWORD,
  signUpOwner,
  test,
  totpCode,
  uniqueEmail,
  waitForEmail,
} from "./fixtures";

// ROADMAP M3 definition of done: sign-up → MFA → invite a user → the user accepts and gets
// the right role. Runs in Arabic, the default locale.
test("an owner signs up, turns on MFA, invites a colleague who joins as staff", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  // A long journey across two browsers; the dev server compiles pages on first visit.
  test.setTimeout(120_000);
  const ownerEmail = uniqueEmail("owner");
  const staffEmail = uniqueEmail("nurse");

  // Visitors are sent to sign in.
  await page.goto("/ar");
  await expect(page).toHaveURL(/\/ar\/sign-in$/);
  await page.getByRole("link", { name: "أنشئ حسابًا" }).click();

  // Sign up.
  await page.getByLabel("الاسم الكامل").fill("هند المالكي");
  await page.getByLabel("البريد الإلكتروني").fill(ownerEmail);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  // First run: the organization and its first facility.
  await expect(page).toHaveURL(/\/ar\/setup$/);
  await page.getByLabel("اسم المنظمة").fill("مجموعة النور التجريبية");
  await page.getByLabel("اسم المنشأة بالعربية").fill("عيادات النور التجريبية");
  await page.getByLabel("اسم المنشأة بالإنجليزية").fill("Al-Noor Demo Clinics");
  await page.getByLabel("نوع المنشأة").selectOption("polyclinic");
  await page.getByRole("button", { name: "إنشاء المنظمة" }).click();

  // An owner cannot use the app without a second factor.
  await expect(page).toHaveURL(/\/ar\/mfa$/);
  await page.goto("/ar/people");
  await expect(page).toHaveURL(/\/ar\/mfa$/);
  await page.getByLabel("أكّد كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "متابعة" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("أدخل الرمز المكوّن من 6 أرقام من التطبيق").fill(totpCode(secret));
  await page.getByRole("button", { name: "تفعيل التحقق بخطوتين" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");

  // Invite a colleague as staff.
  await page.goto("/ar/people");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأشخاص والصلاحيات");
  await page.getByLabel("البريد الإلكتروني").fill(staffEmail);
  await page.getByLabel("الدور").selectOption("staff");
  await page.getByRole("button", { name: "إرسال الدعوة" }).click();
  await expect(page.getByText("أُرسلت الدعوة.")).toBeVisible();
  await expect(page.getByText(staffEmail)).toBeVisible();

  // The invitation arrives in Arabic with a one-time link.
  const email = await waitForEmail(request, staffEmail);
  expect(email.Subject).toBe("دعوة للانضمام إلى عيادات النور التجريبية على مستمر");
  expect(email.HTML).toContain('dir="rtl"');
  const link = email.Text.match(/https?:\/\/\S+\/ar\/invite\/[A-Za-z0-9_-]+/)![0];
  const invitePath = new URL(link).pathname;

  // The colleague opens the link in their own browser, creates an account and accepts.
  const colleague = await browser.newContext({
    baseURL,
    locale: "ar-SA",
    extraHTTPHeaders: { "x-forwarded-for": "10.200.0.2" },
  });
  const staff = await colleague.newPage();
  await staff.goto(invitePath);
  await expect(staff.getByText("عيادات النور التجريبية")).toBeVisible();
  await expect(staff.getByText("موظف")).toBeVisible();
  await staff.getByRole("link", { name: "أنشئ حسابًا واقبل الدعوة" }).click();
  await expect(staff.getByLabel("البريد الإلكتروني")).toHaveValue(staffEmail);
  await staff.getByLabel("الاسم الكامل").fill("سارة الممرضة");
  await staff.getByLabel("كلمة المرور").fill(PASSWORD);
  await staff.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(staff).toHaveURL(new RegExp(`${invitePath}$`));
  await staff.getByRole("button", { name: "قبول الدعوة" }).click();

  // Staff do not need MFA and land on the dashboard, without access to people management.
  await expect(staff.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
  await staff.goto("/ar/people");
  await expect(
    staff.getByText("إدارة الأشخاص متاحة لمالك المنشأة ومدير الجودة فقط."),
  ).toBeVisible();

  // The link works once.
  await staff.goto(invitePath);
  await expect(staff.getByText("استُخدمت هذه الدعوة من قبل.")).toBeVisible();
  await colleague.close();

  // The owner sees the new member with the role they chose.
  await page.goto("/ar/people");
  await expect(page.getByTestId(`role-${staffEmail}`)).toHaveText("موظف");
  await expect(page.getByText("لا توجد دعوات معلّقة.")).toBeVisible();
});

test("signing in with MFA asks for the authenticator code", async ({ page, baseURL }) => {
  const owner = await signUpOwner(page, baseURL!);
  await page.context().clearCookies();

  await page.goto("/ar/people");
  await expect(page).toHaveURL(/\/ar\/sign-in\?next=%2Fpeople$/);
  await page.getByLabel("البريد الإلكتروني").fill(owner.email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page).toHaveURL(/\/ar\/sign-in\/verify/);
  await page.getByLabel("رمز التحقق").fill("000000");
  await page.getByRole("button", { name: "تحقّق" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("الرمز غير صحيح");
  await page.getByLabel("رمز التحقق").fill(totpCode(owner.secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await expect(page).toHaveURL(/\/ar\/people$/);
});

test("a wrong password shows an error, and five lock the account", async ({ page, baseURL }) => {
  const owner = await signUpOwner(page, baseURL!);
  await page.context().clearCookies();
  await page.goto("/ar/sign-in");
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.getByLabel("البريد الإلكتروني").fill(owner.email);
    await page.getByLabel("كلمة المرور").fill("wrong password 123");
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    );
  }
  // Even the right password is refused while the account is locked.
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "محاولات فاشلة كثيرة. الحساب مقفل لمدة 15 دقيقة.",
  );
});
