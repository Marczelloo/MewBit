import Field from "../controls/Field.jsx";
import { Select, Toggle } from "../controls/Inputs.jsx";

export default function TicketsSection({ settings, commit, savedField, postChannelOptions, blockedChannels, roleOptions }) {
  const tickets = settings.tickets;
  const noChannel = !tickets.channelId;
  const blocked = blockedChannels.has(tickets.channelId);

  return (
    <>
      <Field
        label="Ticket system"
        describe="Members use /ticket create to file a bug report, a feature request or feedback. Administrators answer with /ticket admin respond."
        note={noChannel ? "Choose a channel first — a ticket needs somewhere to be delivered." : null}
        saved={savedField === "ticketsEnabled"}
      >
        <Toggle
          label="Ticket system"
          checked={tickets.enabled}
          disabled={noChannel}
          onChange={(value) => commit({ tickets: { enabled: value } }, "ticketsEnabled")}
        />
      </Field>

      <Field
        label="Notification channel"
        describe="Where a new ticket is posted for the team to pick up."
        note={
          blocked
            ? "MewBit cannot post in this channel. Give it Send Messages and Embed Links there."
            : tickets.enabled
              ? null
              : "The ticket system is off, so nothing will be posted here."
        }
        tone={blocked ? "danger" : "muted"}
        saved={savedField === "ticketChannel"}
      >
        <Select
          value={tickets.channelId}
          onChange={(value) => commit({ tickets: { channelId: value } }, "ticketChannel")}
          options={postChannelOptions}
          placeholder="Not set — the ticket system cannot be turned on"
        />
      </Field>

      <Field
        label="Ping role"
        describe="Mentioned when a ticket arrives. Leave it unset to post without pinging anyone."
        saved={savedField === "ticketRole"}
      >
        <Select
          value={tickets.roleId}
          onChange={(value) => commit({ tickets: { roleId: value } }, "ticketRole")}
          options={roleOptions}
          placeholder="No role — post without a mention"
        />
      </Field>

      <div className="readout">
        <div className="readout-item">
          <b className="mono">{tickets.openCount}</b>
          <span>open</span>
        </div>
        <div className="readout-item">
          <b className="mono">{tickets.totalCount}</b>
          <span>filed in total</span>
        </div>
        <p className="readout-note">
          Read them with <code className="mono">/ticket admin pending</code>.
        </p>
      </div>
    </>
  );
}
