import Field from "../controls/Field.jsx";
import { RoleChecklist, Select, Toggle, ToggleRows } from "../controls/Inputs.jsx";

const CATEGORIES = [
  { id: "message", label: "Messages", describe: "Edits and deletions, with who deleted it when the audit log says." },
  { id: "voice", label: "Voice", describe: "Joins, leaves, moves, mutes and deafens." },
  { id: "server", label: "Server", describe: "Members joining and leaving, role and nickname changes, bans." },
  { id: "bot", label: "Bot", describe: "Command usage and the responses MewBit sent." },
];

export default function LogsSection({ settings, commit, savedField, channelOptions, roleOptions }) {
  const logs = settings.logs;

  // Logging writes into a category of four channels that `/logs setup` creates.
  // Creating them needs Manage Channels and is provisioning, not configuration,
  // so this section reports the state instead of pretending it can do it.
  if (!logs.configured) {
    return (
      <div className="notice">
        <b>Logging is not set up in this server yet.</b>
        <p>
          Run <code className="mono">/logs setup</code> in Discord. It creates a private category with a channel for
          each kind of log, visible to administrators only. Everything on this page becomes editable once it exists.
        </p>
      </div>
    );
  }

  const anyCategory = CATEGORIES.some((category) => logs.categories[category.id]);

  return (
    <>
      <Field
        label="Logging"
        describe="The master switch. With it off, nothing is written to any log channel."
        note={anyCategory ? null : "Every category below is off, so logging stays off."}
        saved={savedField === "logsEnabled"}
      >
        <Toggle
          label="Logging"
          checked={logs.enabled}
          disabled={!anyCategory}
          onChange={(value) => commit({ logs: { enabled: value } }, "logsEnabled")}
        />
      </Field>

      <Field
        label="What gets logged"
        describe="Each kind of event writes to its own channel. Turning the last one off also turns logging off, which is what /logs disable does."
        saved={savedField === "logCategories"}
        wide
      >
        <ToggleRows
          rows={CATEGORIES.map((category) => ({
            ...category,
            checked: Boolean(logs.categories[category.id]),
          }))}
          onChange={(id, value) => commit({ logs: { categories: { [id]: value } } }, "logCategories")}
        />
      </Field>

      {CATEGORIES.map((category) => (
        <Field
          key={category.id}
          label={`${category.label} channel`}
          describe={`Where ${category.label.toLowerCase()} events are written.`}
          note={logs.categories[category.id] ? null : `${category.label} logging is off, so nothing is written here.`}
          saved={savedField === `logChannel:${category.id}`}
        >
          <Select
            value={logs.channels[category.id]}
            onChange={(value) => commit({ logs: { channels: { [category.id]: value } } }, `logChannel:${category.id}`)}
            options={channelOptions}
          />
        </Field>
      ))}

      <Field
        label="Who can read the logs"
        describe="Administrators always can. Each role added here is granted read-only access to the log category and every channel in it, exactly as /logs access does."
        note="Changing this edits Discord permissions, so it can fail if MewBit cannot manage the log channels."
        saved={savedField === "accessRoles"}
        wide
      >
        <RoleChecklist
          selected={logs.accessRoles}
          options={roleOptions}
          empty="This server has no roles MewBit can grant access to."
          onToggle={(roleId, on) =>
            commit(
              {
                logs: {
                  accessRoles: on
                    ? [...logs.accessRoles, roleId]
                    : logs.accessRoles.filter((id) => id !== roleId),
                },
              },
              "accessRoles"
            )
          }
        />
      </Field>
    </>
  );
}
