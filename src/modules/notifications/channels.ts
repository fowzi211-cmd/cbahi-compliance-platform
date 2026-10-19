// Delivery channels beyond the app and email. SMS and WhatsApp are stubs for now: the
// interface is fixed so a KSA-hosted provider can be added without touching the jobs, but
// nothing is sent and no phone numbers are stored until a provider and a lawful basis for
// holding staff numbers (PDPL) are agreed with the owner.

export const externalChannels = ["sms", "whatsapp"] as const;
export type ExternalChannel = (typeof externalChannels)[number];

export type ChannelMessage = { to: string; text: string; locale: "ar" | "en" };
export type ChannelResult = { ok: true } | { ok: false; reason: "notConfigured" };

export type Channel = {
  name: ExternalChannel;
  configured: boolean;
  send(message: ChannelMessage): Promise<ChannelResult>;
};

const notConfigured = (name: ExternalChannel): Channel => ({
  name,
  configured: false,
  send: async () => ({ ok: false, reason: "notConfigured" }),
});

export const channels: Record<ExternalChannel, Channel> = {
  sms: notConfigured("sms"),
  whatsapp: notConfigured("whatsapp"),
};
