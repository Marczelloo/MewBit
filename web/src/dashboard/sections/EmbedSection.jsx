import { useEffect, useState } from "react";
import { getEmbedOptions, postEmbed } from "../../api.js";
import Field from "../controls/Field.jsx";
import { Select, Toggle } from "../controls/Inputs.jsx";

const EMPTY = {
  channelId: null,
  // The colour default comes from the gateway, which owns the brand palette.
  color: null,
  title: "",
  description: "",
  footer: "",
  author: "",
  image: "",
  thumbnail: "",
  timestamp: false,
};

function Counter({ value, limit }) {
  const used = value.length;
  const near = used > limit * 0.9;
  return (
    <span className={near ? "mono counter is-near" : "mono counter"}>
      {used}/{limit}
    </span>
  );
}

/**
 * Composing a custom embed.
 *
 * This is the only section that acts instead of configuring, so it does not
 * autosave: nothing happens until Send, and the preview is what will be posted.
 * A Discord modal caps at five inputs and shows no preview, which is the whole
 * reason this is worth having on the web.
 */
export default function EmbedSection({ guildId }) {
  const [options, setOptions] = useState(null);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setDraft(EMPTY);
    setSent(null);
    setError(null);

    getEmbedOptions(guildId)
      .then((payload) => {
        if (cancelled) return;
        setOptions(payload.options);
        setDraft((current) => ({ ...current, color: payload.options.defaultColor }));
      })
      .catch((apiError) => {
        if (!cancelled) setError(apiError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [guildId]);

  if (error && !options) return <p className="panel-error">{error}</p>;

  if (!options) {
    return (
      <div aria-busy="true">
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line is-short" />
      </div>
    );
  }

  const set = (key) => (value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSent(null);
  };

  const channel = options.channels.find((entry) => entry.id === draft.channelId) || null;
  const blocked = channel && !channel.canPost;
  const ready = Boolean(draft.channelId && draft.title.trim() && draft.description.trim() && !blocked);

  async function send() {
    setPending(true);
    setError(null);
    setSent(null);
    try {
      const payload = await postEmbed(guildId, draft);
      setSent(payload.sent);
      setDraft((current) => ({ ...EMPTY, channelId: current.channelId, color: current.color }));
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error ? <p className="panel-error">{error}</p> : null}
      {sent ? (
        <p className="panel-sent">
          Posted in #{sent.channelName}.{" "}
          <a href={sent.url} target="_blank" rel="noreferrer noopener">
            Open it in Discord
          </a>
        </p>
      ) : null}

      <Field
        label="Channel"
        describe="Where the embed is posted. MewBit must be able to send messages and embed links there."
        note={blocked ? `MewBit cannot post in #${channel.name}. Give it Send Messages and Embed Links first.` : null}
        tone={blocked ? "danger" : "muted"}
      >
        <Select
          value={draft.channelId}
          onChange={set("channelId")}
          options={options.channels.map((entry) => ({
            value: entry.id,
            label: entry.canPost ? `#${entry.name}` : `#${entry.name} — cannot post`,
          }))}
          placeholder="Choose a channel"
        />
      </Field>

      <Field label="Colour" describe="The stripe down the left edge of the embed.">
        <Select value={draft.color || options.defaultColor} onChange={set("color")} options={options.colors} />
      </Field>

      <Field label="Title" describe="Shown in bold at the top." wide>
        <div className="composer-row">
          <input
            className="input"
            value={draft.title}
            maxLength={options.limits.title}
            onChange={(event) => set("title")(event.target.value)}
            placeholder="Server rules"
          />
          <Counter value={draft.title} limit={options.limits.title} />
        </div>
      </Field>

      <Field label="Description" describe="The body. Discord markdown works here — **bold**, links, and line breaks." wide>
        <div className="composer-row">
          <textarea
            className="input textarea"
            rows={7}
            value={draft.description}
            maxLength={options.limits.description}
            onChange={(event) => set("description")(event.target.value)}
            placeholder="Write the message…"
          />
          <Counter value={draft.description} limit={options.limits.description} />
        </div>
      </Field>

      <Field label="Author" describe="A small line above the title. Optional.">
        <input
          className="input"
          value={draft.author}
          maxLength={options.limits.author}
          onChange={(event) => set("author")(event.target.value)}
          placeholder="Optional"
        />
      </Field>

      <Field label="Footer" describe="A small line under the body. Optional.">
        <input
          className="input"
          value={draft.footer}
          maxLength={options.limits.footer}
          onChange={(event) => set("footer")(event.target.value)}
          placeholder="Optional"
        />
      </Field>

      <Field label="Image" describe="A large image under the body. Must be a direct http or https link.">
        <input
          className="input"
          value={draft.image}
          onChange={(event) => set("image")(event.target.value)}
          placeholder="https://…"
        />
      </Field>

      <Field label="Thumbnail" describe="A small image in the top-right corner.">
        <input
          className="input"
          value={draft.thumbnail}
          onChange={(event) => set("thumbnail")(event.target.value)}
          placeholder="https://…"
        />
      </Field>

      <Field label="Timestamp" describe="Adds the current time to the footer when it is sent.">
        <Toggle label="Timestamp" checked={draft.timestamp} onChange={set("timestamp")} />
      </Field>

      <div className="statblock">
        <h3>Preview</h3>
        <div className="embed-preview" style={{ "--embed-stripe": draft.color || options.defaultColor }}>
          {draft.author ? <p className="embed-author">{draft.author}</p> : null}
          <p className="embed-title">{draft.title || "Title"}</p>
          <p className="embed-description">{draft.description || "The body of the message appears here."}</p>
          {draft.image ? (
            <img className="embed-image" src={draft.image} alt="" onError={(event) => event.currentTarget.remove()} />
          ) : null}
          {draft.footer || draft.timestamp ? (
            <p className="embed-footer">
              {draft.footer}
              {draft.footer && draft.timestamp ? " • " : ""}
              {draft.timestamp ? "just now" : ""}
            </p>
          ) : null}
        </div>
        <p className="statblock-note">
          Nothing is posted until you press Send. This section does not autosave, unlike the rest of the dashboard.
        </p>

        <div className="foot-actions">
          <button type="button" className="btn-white" disabled={!ready || pending} onClick={send}>
            {pending ? "Sending…" : "Send to Discord"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => {
              setDraft((current) => ({ ...EMPTY, channelId: current.channelId, color: current.color }));
              setSent(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </>
  );
}
