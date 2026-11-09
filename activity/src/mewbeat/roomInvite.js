import { inviteMessage } from "./room.js";

const LINK_PREFIX = "room:";
const SHARE_MESSAGE = "Come play mewbeat with me!";

// The room code out of the custom_id an Activity link opened with; null when it is not a room invite.
export function parseRoomInvite(customId) {
  if (typeof customId !== "string" || !customId.startsWith(LINK_PREFIX)) return null;
  return customId.slice(LINK_PREFIX.length) || null;
}

// The bot posts in the voice channel's chat when the player is on one. Otherwise Discord's own share window sends a
// link that brings the other person into this room. What to show after it, or null when the player closed the window.
export async function sendRoomInvite({ store, sdk }) {
  const reply = await store.invite();
  if (reply?.reason !== "no_voice_channel" || !sdk?.commands?.shareLink) return inviteMessage(reply);
  const link = await store.inviteLink();
  if (link?.status !== "ok") return inviteMessage(link);
  try {
    const shared = await sdk.commands.shareLink({ message: SHARE_MESSAGE, custom_id: `${LINK_PREFIX}${link.code}` });
    return shared?.success ? { ok: true, text: "Invite shared." } : null;
  } catch {
    return { ok: false, text: "Discord couldn't open the share window." };
  }
}
