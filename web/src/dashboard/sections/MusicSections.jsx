import Field from "../controls/Field.jsx";
import { Select, Slider, Toggle } from "../controls/Inputs.jsx";

const SOURCE_OPTIONS = [
  { value: "deezer", label: "Deezer — FLAC quality" },
  { value: "youtube", label: "YouTube — widest catalogue" },
  { value: "spotify", label: "Spotify — resolved through other sources" },
  { value: "soundcloud", label: "SoundCloud — independent uploads" },
];

const SKIP_OPTIONS = [
  { value: "dj", label: "DJ only — only the DJ role can skip" },
  { value: "vote", label: "Vote — listeners vote to skip" },
  { value: "hybrid", label: "Hybrid — DJ skips outright, others vote" },
];

const CANNOT_POST_NOTE = "MewBit cannot post in this channel. Give it Send Messages and Embed Links there.";

export function PlayerSection({ settings, commit, savedField, postChannelOptions, blockedChannels }) {
  const playerBlocked = blockedChannels.has(settings.player.playerChannel);

  return (
    <>
      <Field
        label="Player channel"
        describe="MewBit posts its player message here, and the Activity opens against this channel."
        note={playerBlocked ? CANNOT_POST_NOTE : null}
        tone={playerBlocked ? "danger" : "muted"}
        saved={savedField === "playerChannel"}
      >
        <Select
          value={settings.player.playerChannel}
          onChange={(value) => commit({ player: { playerChannel: value } }, "playerChannel")}
          options={postChannelOptions}
          placeholder="Not set — posts wherever the command was used"
        />
      </Field>

      <Field
        label="Autoplay"
        describe="When the queue empties, MewBit keeps playing with tracks it picks from what you have been listening to."
        saved={savedField === "autoplay"}
      >
        <Toggle
          label="Autoplay"
          checked={settings.player.autoplay}
          onChange={(value) => commit({ player: { autoplay: value } }, "autoplay")}
        />
      </Field>

      <Field
        label="24/7 radio"
        describe="When the queue ends, MewBit keeps queueing tracks based on what was played and never leaves for inactivity. /stop turns it off. Can be switched on ahead of time; it takes effect when music next plays."
        saved={savedField === "radio247"}
      >
        <Toggle
          label="24/7 radio"
          checked={settings.player.radio247}
          onChange={(value) => commit({ player: { radio247: value } }, "radio247")}
        />
      </Field>
    </>
  );
}

export function SourceSection({ settings, commit, savedField }) {
  return (
    <Field
      label="Default search source"
      describe="Where a plain /play query resolves first. A member who sets their own preference overrides this."
      saved={savedField === "defaultSource"}
    >
      <Select
        value={settings.source.defaultSource}
        onChange={(value) => commit({ source: { defaultSource: value } }, "defaultSource")}
        options={SOURCE_OPTIONS}
      />
    </Field>
  );
}

export function DjSection({ settings, commit, savedField, roleOptions }) {
  const dj = settings.dj;
  const djOff = !dj.enabled;
  // DJ mode with nobody to be the DJ would lock out everyone but the owner, so
  // the role comes first and the switch waits for it.
  const needsRole = !dj.enabled && !dj.roleId;
  const thresholdUnused = dj.enabled && dj.skipMode === "dj";
  const offNote = djOff ? "DJ mode is off — everyone can control playback." : null;

  return (
    <>
      <Field
        label="DJ mode"
        describe="With DJ mode off, anyone in the voice channel can skip, stop, and reorder the queue."
        note={needsRole ? "Choose a DJ role first." : null}
        saved={savedField === "enabled"}
      >
        <Toggle
          label="DJ mode"
          checked={dj.enabled}
          disabled={needsRole}
          onChange={(value) => commit({ dj: { enabled: value } }, "enabled")}
        />
      </Field>

      <Field
        label="DJ role"
        describe="Members with this role control playback while DJ mode is on. The server owner always can."
        saved={savedField === "roleId"}
      >
        <Select
          value={dj.roleId}
          onChange={(value) => commit({ dj: { roleId: value } }, "roleId")}
          options={roleOptions}
          placeholder="No role"
        />
      </Field>

      <Field
        label="Skip mode"
        describe="How a track gets skipped when someone who is not a DJ asks for it."
        note={offNote}
        saved={savedField === "skipMode"}
      >
        <Select
          value={dj.skipMode}
          disabled={djOff}
          onChange={(value) => commit({ dj: { skipMode: value } }, "skipMode")}
          options={SKIP_OPTIONS}
        />
      </Field>

      <Field
        label="Vote threshold"
        describe="The share of listeners in the voice channel who must vote before a track is skipped."
        note={offNote || (thresholdUnused ? "Skip mode is DJ-only, so the vote threshold is unused." : null)}
        saved={savedField === "voteThreshold"}
      >
        <Slider
          value={dj.voteThreshold}
          disabled={djOff || thresholdUnused}
          min={0.1}
          max={1}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          label="Vote threshold"
          onCommit={(value) => commit({ dj: { voteThreshold: value } }, "voteThreshold")}
        />
      </Field>

      <Field
        label="Strict mode"
        describe="Only the DJ role and the server owner control playback. Without it, members with Administrator, Manage Server or Manage Channels also can."
        note={offNote}
        saved={savedField === "strictMode"}
      >
        <Toggle
          label="Strict mode"
          checked={dj.strictMode}
          disabled={djOff}
          onChange={(value) => commit({ dj: { strictMode: value } }, "strictMode")}
        />
      </Field>
    </>
  );
}

export function AnnouncementsSection({ settings, commit, savedField, postChannelOptions, blockedChannels }) {
  const on = settings.announcements.announcementsEnabled;
  const blocked = blockedChannels.has(settings.announcements.announcementChannel);

  return (
    <>
      <Field
        label="Announcements"
        describe="MewBit posts a short note when the bot updates to a new version."
        saved={savedField === "announcementsEnabled"}
      >
        <Toggle
          label="Announcements"
          checked={on}
          onChange={(value) => commit({ announcements: { announcementsEnabled: value } }, "announcementsEnabled")}
        />
      </Field>

      <Field
        label="Announcement channel"
        describe="Where those update notes are posted."
        note={blocked ? CANNOT_POST_NOTE : on ? null : "Announcements are off, so nothing will be posted here."}
        tone={blocked ? "danger" : "muted"}
        saved={savedField === "announcementChannel"}
      >
        <Select
          value={settings.announcements.announcementChannel}
          disabled={!on}
          onChange={(value) => commit({ announcements: { announcementChannel: value } }, "announcementChannel")}
          options={postChannelOptions}
          placeholder="Not set — no update notes are posted"
        />
      </Field>
    </>
  );
}
