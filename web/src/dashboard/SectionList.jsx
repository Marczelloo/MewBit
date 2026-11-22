import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";

/**
 * Eight sections is past the point where a flat list reads as one thing, so
 * they are grouped by what they govern: how music behaves, how the server is
 * run, and what has happened. The groups are labels, not routes.
 */
export const SECTION_GROUPS = [
  {
    id: "music",
    label: "Music",
    sections: [
      { id: "player", label: "Player", hint: "Channel, autoplay, 24/7" },
      { id: "source", label: "Source", hint: "Default search provider" },
      { id: "equalizer", label: "Sound", hint: "Equalizer and effects" },
      { id: "dj", label: "DJ", hint: "Role gating and skip votes" },
      { id: "playlists", label: "Playlists", hint: "Shared with the whole server" },
    ],
  },
  {
    id: "server",
    label: "Server",
    sections: [
      { id: "announcements", label: "Announcements", hint: "Update posts" },
      { id: "logs", label: "Server logs", hint: "What gets recorded, and who reads it" },
      { id: "tickets", label: "Tickets", hint: "Reports and feedback" },
      { id: "embed", label: "Embeds", hint: "Post a custom message" },
      { id: "access", label: "Access", hint: "Who may use this dashboard" },
    ],
  },
  {
    id: "insight",
    label: "Insight",
    sections: [
      { id: "stats", label: "Statistics", hint: "This server's listening history" },
      { id: "instance", label: "Instance", hint: "Health of the bot itself" },
    ],
  },
];

export const SECTIONS = SECTION_GROUPS.flatMap((group) => group.sections);

export const DEFAULT_SECTION = "player";

export function isSection(value) {
  return SECTIONS.some((section) => section.id === value);
}

export default function SectionList({ guildId }) {
  const strip = useRef(null);
  const { pathname } = useLocation();

  // On a phone the list is one horizontal strip. Keep the active section in
  // view when it is entered by a link or a reload rather than by tapping it.
  useEffect(() => {
    const nav = strip.current;
    const active = nav?.querySelector(".is-active");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({
      left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [pathname]);

  return (
    <nav className="sections" aria-label="Settings sections" ref={strip}>
      {SECTION_GROUPS.map((group) => (
        <div className="section-group" key={group.id}>
          <h2 className="section-group-label">{group.label}</h2>
          {group.sections.map((section) => (
            <NavLink
              key={section.id}
              to={`/dashboard/${guildId}/${section.id}`}
              className={({ isActive }) => (isActive ? "section-link is-active" : "section-link")}
            >
              <b>{section.label}</b>
              <small>{section.hint}</small>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
