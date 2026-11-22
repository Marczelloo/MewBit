import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings, patchSettings } from "../api.js";
import SaveState from "./SaveState.jsx";
import AccessSection from "./sections/AccessSection.jsx";
import EmbedSection from "./sections/EmbedSection.jsx";
import EqualizerSection from "./sections/EqualizerSection.jsx";
import InstanceSection from "./sections/InstanceSection.jsx";
import LogsSection from "./sections/LogsSection.jsx";
import PlaylistsSection from "./sections/PlaylistsSection.jsx";
import { AnnouncementsSection, DjSection, PlayerSection, SourceSection } from "./sections/MusicSections.jsx";
import StatsSection from "./sections/StatsSection.jsx";
import TicketsSection from "./sections/TicketsSection.jsx";

const SECTION_COPY = {
  player: {
    title: "Player",
    lead: "Where MewBit posts its player and how it behaves when the queue runs dry.",
  },
  source: {
    title: "Source",
    lead: "Which provider a bare search resolves against. Members can override this for themselves.",
  },
  equalizer: {
    title: "Sound",
    lead: "The equalizer and audio effect this server keeps. Both are restored every time MewBit starts playing.",
  },
  playlists: {
    title: "Playlists",
    lead: "The playlists this server shares. Personal ones belong to their owner and are not shown here.",
  },
  dj: {
    title: "DJ",
    lead: "Who is allowed to change playback for everyone else.",
  },
  announcements: {
    title: "Announcements",
    lead: "Where MewBit posts update notes when the bot version changes.",
  },
  logs: {
    title: "Server logs",
    lead: "What MewBit records about this server, and which roles are allowed to read it.",
  },
  tickets: {
    title: "Tickets",
    lead: "How members report bugs, request features, and send feedback.",
  },
  embed: {
    title: "Embeds",
    lead: "Compose a message and post it to a channel as MewBit. Nothing is sent until you press Send.",
  },
  access: {
    title: "Access",
    lead: "Who may change this server's settings here, and what they have changed.",
  },
  instance: {
    title: "Instance",
    lead: "How the bot process itself is doing. This is the whole instance, not just this server.",
  },
  stats: {
    title: "Statistics",
    lead: "What this server has listened to. Nothing here can be changed.",
  },
};

/* Sections whose controls write on change. The rest either only report, or
   wait for an explicit action. */
const AUTOSAVING_SECTIONS = new Set([
  "player",
  "source",
  "equalizer",
  "dj",
  "announcements",
  "logs",
  "tickets",
]);

const SECTION_COMPONENTS = {
  player: PlayerSection,
  source: SourceSection,
  equalizer: EqualizerSection,
  dj: DjSection,
  playlists: PlaylistsSection,
  announcements: AnnouncementsSection,
  logs: LogsSection,
  tickets: TicketsSection,
  embed: EmbedSection,
  access: AccessSection,
  stats: StatsSection,
  instance: InstanceSection,
};

export default function SettingsPanel({ guildId, section, sectionLabel, guildName }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [saveState, setSaveState] = useState("idle");
  const [savedField, setSavedField] = useState(null);
  const savedTimer = useRef(null);
  // Every save is numbered. Two quick changes are two requests in flight, and
  // only the newest one may touch the screen: an older response landing late
  // would put the previous value back on a control the user already moved.
  const requestSeq = useRef(0);
  // The newest settings the server has confirmed, and the request that
  // produced them. A failed save reverts to this, not to a stale closure.
  const serverState = useRef({ settings: null, seq: 0 });
  const inFlight = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);
    setWarnings([]);
    // Anything still in flight for the previous server is now stale.
    requestSeq.current += 1;
    inFlight.current = 0;
    serverState.current = { settings: null, seq: requestSeq.current };

    getSettings(guildId)
      .then((payload) => {
        if (cancelled) return;
        serverState.current = { settings: payload.settings, seq: requestSeq.current };
        setSettings(payload.settings);
      })
      .catch((apiError) => {
        if (!cancelled) setError(apiError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [guildId]);

  // A message about one section has no business following the user to the next.
  // Skipped when the first load failed: that error is the whole screen.
  useEffect(() => {
    if (!serverState.current.settings) return;
    setError(null);
    setWarnings([]);
  }, [section]);

  // Statistics are read-only and move on their own while the page is open, so
  // opening them fetches again rather than showing what the first load saw.
  useEffect(() => {
    if (section !== "stats") return undefined;
    let cancelled = false;

    getSettings(guildId)
      .then((payload) => {
        if (cancelled) return;
        // Not while a save is in flight: its response is the newer truth.
        if (inFlight.current > 0) return;
        serverState.current = { settings: payload.settings, seq: requestSeq.current };
        setSettings(payload.settings);
      })
      .catch((apiError) => {
        if (!cancelled) setError(apiError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [guildId, section]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const commit = useCallback(
    async (patch, fieldKey) => {
      requestSeq.current += 1;
      const seq = requestSeq.current;
      // Optimistic, one level deep into each group so a control responds now.
      setSettings((current) => {
        const next = { ...current };
        for (const [group, values] of Object.entries(patch)) {
          next[group] = { ...next[group], ...values };
        }
        return next;
      });
      setSaveState("saving");
      setError(null);
      setWarnings([]);
      inFlight.current += 1;

      try {
        const payload = await patchSettings(guildId, patch);
        // The newest confirmed state, even if a later request has since been
        // sent: it is what a later failure reverts to.
        if (seq > serverState.current.seq) {
          serverState.current = { settings: payload.settings, seq };
        }
        // Only the newest request may update the screen; an older response
        // would undo a change the user has already made on top of it.
        if (seq !== requestSeq.current) return;

        // Replace wholesale: a slash command may have changed something else,
        // and a nested group like logs.categories cannot be merged shallowly.
        setSettings(payload.settings);
        // A patch can partly succeed — a log role Discord refused, say — so a
        // warning is shown alongside the save rather than instead of it.
        setWarnings(payload.warnings || []);
        setSaveState("saved");
        setSavedField(fieldKey);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          setSaveState("idle");
          setSavedField(null);
        }, 2200);
      } catch (apiError) {
        if (seq !== requestSeq.current) return;
        // Back to what the server last confirmed, not to whatever the closure
        // happened to hold when this request was made.
        if (serverState.current.settings) setSettings(serverState.current.settings);
        setSaveState("idle");
        setError(apiError.message);
      } finally {
        inFlight.current = Math.max(0, inFlight.current - 1);
      }
    },
    [guildId]
  );

  if (error && !settings) {
    return (
      <section className="panel">
        <div className="panel-scroll">
          <p className="panel-error">{error}</p>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="panel" aria-busy="true">
        <div className="panel-scroll">
          <span className="visually-hidden">Loading {sectionLabel} settings</span>
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line is-short" />
        </div>
      </section>
    );
  }

  const copy = SECTION_COPY[section];
  const Section = SECTION_COMPONENTS[section];
  const channelOptions = settings.options.channels.map((channel) => ({
    value: channel.id,
    label: `#${channel.name}`,
  }));
  // Channels MewBit is not allowed to post in. Still selectable, because the
  // permission can be granted afterwards; the label and a note say so instead.
  const blockedChannels = new Set(
    settings.options.channels.filter((channel) => channel.canPost === false).map((channel) => channel.id)
  );
  const postChannelOptions = settings.options.channels.map((channel) => ({
    value: channel.id,
    label: blockedChannels.has(channel.id)
      ? `#${channel.name} — MewBit cannot post here`
      : `#${channel.name}`,
  }));
  const roleOptions = settings.options.roles.map((role) => ({
    value: role.id,
    label: `@${role.name}`,
  }));

  return (
    <section className="panel">
      <div className="panel-scroll">
        <div className="panel-head">
          <h2>{copy.title}</h2>
          <p>{copy.lead}</p>
        </div>

        {error ? <p className="panel-error">{error}</p> : null}
        {warnings.map((warning) => (
          <p className="panel-warning" key={warning}>
            {warning}
          </p>
        ))}

        <Section
          guildId={guildId}
          settings={settings}
          commit={commit}
          savedField={savedField}
          channelOptions={channelOptions}
          postChannelOptions={postChannelOptions}
          blockedChannels={blockedChannels}
          roleOptions={roleOptions}
        />
      </div>

      <SaveState state={saveState} guildName={guildName} autosaves={AUTOSAVING_SECTIONS.has(section)} />
    </section>
  );
}
