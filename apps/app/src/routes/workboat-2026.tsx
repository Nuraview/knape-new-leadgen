/**
 * Public landing page for the International WorkBoat Show 2026 outreach:
 * https://crm.knapesolutions.com/workboat-2026
 *
 * Knape is not exhibiting at WorkBoat this year; its territory is Texas and
 * Louisiana. The pre-show emails (messaging_angles.EVENT_ANGLE_SETS
 * ["workboat-2026"]) link here, so the page has one job: tell a Gulf Coast
 * operator or yard what a Houston air-movement rep does for workboats, and
 * take an enquiry. Every claim on it is a Knape fact (Houston, since 1949, the
 * equipment, the represented manufacturers, the territory); no specs, lead
 * times, certifications or customer names.
 *
 * The form posts to /api/leadgen-public/inquiry, which forwards to the
 * cockpit's inbound capture (sample_leads, the CRM's Inbound page, and the new
 * lead alert). A flat route outside _authenticated, like post.$token, so a
 * visitor never meets a sign-in wall.
 *
 * Deliberately its own visual world rather than the CRM shell: a technical
 * drawing of a workboat on a chart-grid ground, signal orange for airflow.
 */
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";

const CONTACT_EMAIL = "peter@knapesolutions.com";
const SOURCE = "workboat-2026-landing";

const INTERESTS = [
	"Engine room ventilation",
	"Accommodation heating & ventilation",
	"Galley exhaust & make-up air",
	"Louvers & dampers",
	"Industrial heaters",
	"Shipyard / repair / refit project",
	"Dust collection & fume extraction",
	"Something else",
];

const HELP = [
	[
		"Engine room ventilation",
		"Supply and exhaust fans that feed combustion air and carry the heat out, sized for the space you actually have.",
	],
	[
		"Accommodation & wheelhouse",
		"Heating, ventilation and galley exhaust for cabins, galley and wheelhouse.",
	],
	[
		"Louvers & dampers",
		"Intake and exhaust openings chosen together with the fans, so the air gets through and the weather stays out.",
	],
	[
		"Heaters & make-up air",
		"Industrial heaters and make-up air for boats, fab shops and covered bays.",
	],
	[
		"Refits, repowers, newbuilds",
		"Get the air side on the drawing early, while the selection is still open.",
	],
	[
		"Yard shops",
		"Dust collection and fume extraction for the shops that keep the fleet running.",
	],
] as const;

const LINES = [
	"Hartzell Air Movement",
	"Loren Cook",
	"Woods Air Movement",
	"Barry Blowers",
	"Soler & Palau",
	"American Warming & Ventilating",
	"Indeeco",
	"CaptiveAire",
	"Pottorff",
	"Industrial Air Technology",
	"Fan Equipment Co.",
	"Schischek",
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
.wb{--navy:#0a1726;--hull:#10243a;--steel:#1b3550;--rule:rgba(186,208,230,.14);--bone:#f2ede3;--mute:#9fb3c8;--sig:#ff5a1f;
 font-family:'IBM Plex Sans',ui-sans-serif,sans-serif;color:var(--bone);background:var(--navy);}
.wb-display{font-family:'Big Shoulders Display',ui-sans-serif,sans-serif;letter-spacing:-.01em;line-height:.92}
.wb-mono{font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
.wb-chart{background-image:
 linear-gradient(var(--rule) 1px,transparent 1px),linear-gradient(90deg,var(--rule) 1px,transparent 1px),
 linear-gradient(rgba(186,208,230,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(186,208,230,.05) 1px,transparent 1px),
 radial-gradient(ellipse at 70% 10%,rgba(255,90,31,.10),transparent 55%);
 background-size:120px 120px,120px 120px,24px 24px,24px 24px,100% 100%}
.wb-flow{stroke-dasharray:6 7;animation:wb-flow 1.6s linear infinite}
@keyframes wb-flow{to{stroke-dashoffset:-26}}
.wb-rise{opacity:0;transform:translateY(14px);animation:wb-rise .8s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes wb-rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.wb-flow,.wb-rise{animation:none;opacity:1;transform:none}}
.wb-field{width:100%;background:rgba(10,23,38,.6);border:1px solid rgba(186,208,230,.25);border-radius:2px;padding:.65rem .75rem;color:var(--bone);font-size:.95rem;outline:none;transition:border-color .15s,box-shadow .15s}
.wb-field:focus{border-color:var(--sig);box-shadow:0 0 0 3px rgba(255,90,31,.18)}
.wb-field::placeholder{color:#6f849a}
`;

/** Section drawing: intake louver -> engine room -> exhaust, heat forward. */
function Schematic() {
	return (
		<svg
			viewBox="0 0 600 270"
			className="w-full"
			role="img"
			aria-label="Workboat profile: air enters through an intake louver, runs through the engine room and leaves by the exhaust fan; the accommodation is heated."
		>
			<title>Workboat ventilation schematic</title>
			<g fill="none" stroke="#bad0e6" strokeOpacity=".75" strokeWidth="1.4">
				{/* hull, deck, house, stack */}
				<path d="M30 150 H505 Q548 150 566 118 L578 118 L562 178 Q540 210 498 214 H72 Q40 214 30 192 Z" />
				<path d="M360 150 V72 H492 V150" />
				<path d="M380 72 V42 H472 V72" />
				<path d="M392 52 H460" strokeOpacity=".5" />
				<path d="M168 150 V108 H244 V150" />
				<path d="M250 150 V86 H278 V150" />
				<path d="M140 158 H312 V202 H140 Z" strokeDasharray="4 4" strokeOpacity=".55" />
				{/* louver blades */}
				{[116, 124, 132, 140].map((y) => (
					<path key={y} d={`M176 ${y} l14 4`} strokeOpacity=".7" />
				))}
				{/* waterline + sea */}
				<path d="M8 200 H592" strokeOpacity=".35" strokeDasharray="2 6" />
				<path
					d="M8 232 q18 -8 36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0 t36 0"
					strokeOpacity=".22"
				/>
			</g>

			{/* airflow */}
			<g fill="none" stroke="#ff5a1f" strokeWidth="2.2" strokeLinecap="round">
				<path className="wb-flow" d="M86 126 H182 V180 H264 V48" />
				<path d="M258 56 L264 44 L270 56" strokeDasharray="none" />
				<path d="M176 120 L184 126 L176 132" strokeDasharray="none" />
			</g>
			{/* heat, forward */}
			<g fill="none" stroke="#ff5a1f" strokeOpacity=".8" strokeWidth="1.6">
				{[392, 420, 448].map((x) => (
					<path
						key={x}
						d={`M${x} 138 q6 -8 0 -16 t0 -16 t0 -16`}
						className="wb-flow"
					/>
				))}
			</g>

			<g
				fontFamily="IBM Plex Mono, monospace"
				fontSize="9.5"
				fill="#9fb3c8"
				letterSpacing=".08em"
			>
				<text x="40" y="112">
					INTAKE LOUVER
				</text>
				<text x="150" y="228">
					ENGINE ROOM: COMBUSTION AIR + HEAT OUT
				</text>
				<text x="286" y="40">
					EXHAUST FAN
				</text>
				<text x="380" y="166">
					ACCOMMODATION: HEAT + VENT
				</text>
			</g>
		</svg>
	);
}

function InquiryForm() {
	const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
		"idle",
	);
	const [error, setError] = useState("");

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = Object.fromEntries(new FormData(e.currentTarget));
		setState("sending");
		setError("");
		try {
			const res = await fetch(getApiUrl("/leadgen-public/inquiry"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...data, source: SOURCE }),
			});
			const out: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				const msg =
					out && typeof out === "object"
						? "error" in out
							? out.error
							: "message" in out
								? out.message
								: null
						: null;
				throw new Error(
					typeof msg === "string" ? msg : "Something went wrong.",
				);
			}
			setState("sent");
		} catch (err) {
			setError((err as Error).message);
			setState("error");
		}
	}

	if (state === "sent") {
		return (
			<div className="py-10">
				<p className="wb-mono text-[11px] text-[var(--sig)]">RECEIVED</p>
				<p className="wb-display mt-3 text-4xl font-extrabold">
					Thanks. It is with Peter.
				</p>
				<p className="mt-4 text-[var(--mute)]">
					He will reply by email. If it is urgent, write to{" "}
					<a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
						{CONTACT_EMAIL}
					</a>
					.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-3">
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">NAME *</span>
					<input name="name" required autoComplete="name" className="wb-field" />
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">
						WORK EMAIL *
					</span>
					<input
						name="email"
						type="email"
						required
						autoComplete="email"
						className="wb-field"
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">COMPANY</span>
					<input
						name="company"
						autoComplete="organization"
						className="wb-field"
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">ROLE</span>
					<input
						name="role"
						autoComplete="organization-title"
						className="wb-field"
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">PHONE</span>
					<input name="phone" type="tel" autoComplete="tel" className="wb-field" />
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="wb-mono text-[10.5px] text-[var(--mute)]">
						LOOKING AT
					</span>
					<select name="interest" defaultValue="" className="wb-field">
						<option value="">Choose one…</option>
						{INTERESTS.map((i) => (
							<option key={i} value={i}>
								{i}
							</option>
						))}
					</select>
				</label>
			</div>
			<label className="flex flex-col gap-1 text-sm">
				<span className="wb-mono text-[10.5px] text-[var(--mute)]">
					THE SPACE, THE BOAT OR THE PROJECT
				</span>
				<textarea
					name="message"
					rows={4}
					placeholder="e.g. engine room runs hot on our 140 ft supply boats, looking at new supply fans before the next yard period"
					className="wb-field resize-y"
				/>
			</label>
			{/* Honeypot: hidden from people, filled by bots. */}
			<input
				name="website"
				tabIndex={-1}
				autoComplete="off"
				aria-hidden="true"
				className="absolute -left-[9999px] h-0 w-0 opacity-0"
			/>
			{state === "error" ? (
				<p className="text-sm text-[#ff9a7a]">
					{error} You can also email{" "}
					<a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
						{CONTACT_EMAIL}
					</a>
					.
				</p>
			) : null}
			<button
				type="submit"
				disabled={state === "sending"}
				className="wb-mono mt-1 inline-flex items-center justify-center gap-2 bg-[var(--sig)] px-5 py-3.5 text-[13px] font-medium text-[#120a05] transition-[filter,transform] hover:brightness-110 active:translate-y-px disabled:opacity-60"
			>
				{state === "sending" ? "SENDING…" : "SEND IT TO PETER  →"}
			</button>
			<p className="text-xs text-[var(--mute)]">
				Goes straight to Peter at Knape &amp; Associates. No mailing list.
			</p>
		</form>
	);
}

function RouteComponent() {
	return (
		<div className="wb wb-chart relative h-svh w-full overflow-y-auto">
			<PageTitle
				title="Workboat ventilation & heating on the Gulf Coast"
				suffix="Knape & Associates"
			/>
			<style>{CSS}</style>

			{/* Top rule */}
			<header className="mx-auto flex max-w-6xl items-center gap-4 px-5 pt-6 sm:px-8">
				<span className="wb-display text-2xl font-extrabold tracking-wide">
					KNAPE &amp; ASSOCIATES
				</span>
				<span className="wb-mono hidden text-[11px] text-[var(--mute)] sm:inline">
					HOUSTON, TX · SINCE 1949
				</span>
				<a
					href={`mailto:${CONTACT_EMAIL}`}
					className="wb-mono ms-auto text-[11px] text-[var(--mute)] hover:text-[var(--bone)]"
				>
					{CONTACT_EMAIL.toUpperCase()}
				</a>
			</header>

			{/* Hero */}
			<section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:pt-16">
				<div>
					<p
						className="wb-mono wb-rise text-[11px] text-[var(--sig)]"
						style={{ animationDelay: "40ms" }}
					>
						AHEAD OF WORKBOAT 2026 · NEW ORLEANS · DEC 2-4
					</p>
					<h1
						className="wb-display wb-rise mt-4 text-[clamp(3rem,7vw,5.6rem)] font-black uppercase"
						style={{ animationDelay: "120ms" }}
					>
						Air for the boats
						<br />
						that work
						<br />
						<span className="text-[var(--sig)]">the Gulf.</span>
					</h1>
					<p
						className="wb-rise mt-6 max-w-xl text-lg leading-relaxed text-[#d6dde6]"
						style={{ animationDelay: "220ms" }}
					>
						Engine room ventilation, accommodation heating, and the fans,
						louvers, dampers and heaters that keep a workboat and its yard
						running. Knape &amp; Associates is a Houston rep for industrial
						air-movement equipment, with marine and offshore at the core.
						Peter covers Texas and Louisiana.
					</p>
					<div
						className="wb-rise mt-8 border-s-2 border-[var(--sig)] ps-4 text-[15px] text-[var(--mute)]"
						style={{ animationDelay: "300ms" }}
					>
						We are not on the show floor this year. If ventilation or heating is
						on your list for New Orleans, send it over first and you will get
						back what we would look at, so you walk the floor with a short list.
					</div>
				</div>

				{/* Phones: intro, form, drawing. Desktop: the form rides alongside both. */}
				<div
					className="wb-rise self-start border border-[rgba(186,208,230,.22)] bg-[rgba(16,36,58,.82)] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,.7)] backdrop-blur sm:p-7 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1"
					style={{ animationDelay: "260ms" }}
				>
					<p className="wb-mono text-[11px] text-[var(--sig)]">
						SEND PETER THE PROBLEM
					</p>
					<p className="wb-display mb-5 mt-2 text-3xl font-extrabold uppercase">
						What are you working on?
					</p>
					<InquiryForm />
				</div>

				<div className="wb-rise lg:col-start-1" style={{ animationDelay: "380ms" }}>
					<Schematic />
				</div>
			</section>

			{/* What we help with */}
			<section className="border-t border-[var(--rule)] bg-[rgba(10,23,38,.55)]">
				<div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
					<p className="wb-mono text-[11px] text-[var(--mute)]">ON THE BOAT AND IN THE YARD</p>
					<h2 className="wb-display mt-3 text-5xl font-extrabold uppercase">
						Where we help
					</h2>
					<ol className="mt-10 grid gap-px bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
						{HELP.map(([title, body], i) => (
							<li key={title} className="bg-[var(--navy)] p-6">
								<span className="wb-mono text-[11px] text-[var(--sig)]">
									{String(i + 1).padStart(2, "0")}
								</span>
								<p className="wb-display mt-2 text-2xl font-extrabold uppercase">
									{title}
								</p>
								<p className="mt-2 text-[15px] leading-relaxed text-[var(--mute)]">
									{body}
								</p>
							</li>
						))}
					</ol>
				</div>
			</section>

			{/* How it works + line card */}
			<section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2">
				<div>
					<p className="wb-mono text-[11px] text-[var(--mute)]">HOW IT WORKS</p>
					<ol className="mt-6 space-y-6">
						{[
							[
								"Tell us the space",
								"The boat or building, what the space does, what is there now and what is going wrong.",
							],
							[
								"Get a short list back",
								"What we would look at for it, from the manufacturers we represent.",
							],
							[
								"Specify and source it",
								"We help your engineers and builders get the selection onto the drawing and the order placed.",
							],
						].map(([t, b], i) => (
							<li key={t} className="flex gap-4">
								<span className="wb-display w-10 shrink-0 text-4xl font-black text-[var(--sig)]">
									{i + 1}
								</span>
								<div>
									<p className="font-semibold">{t}</p>
									<p className="mt-1 text-[15px] text-[var(--mute)]">{b}</p>
								</div>
							</li>
						))}
					</ol>
				</div>
				<div>
					<p className="wb-mono text-[11px] text-[var(--mute)]">
						MANUFACTURERS WE REPRESENT, AMONG OTHERS
					</p>
					<ul className="mt-6 flex flex-wrap gap-2">
						{LINES.map((l) => (
							<li
								key={l}
								className="border border-[rgba(186,208,230,.22)] px-3 py-1.5 text-sm text-[#d6dde6]"
							>
								{l}
							</li>
						))}
					</ul>
				</div>
			</section>

			<footer className="border-t border-[var(--rule)]">
				<div className="wb-mono mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8 text-[11px] text-[var(--mute)] sm:px-8">
					<span>KNAPE &amp; ASSOCIATES · HOUSTON, TX · SINCE 1949</span>
					<span>TERRITORY: TEXAS &amp; LOUISIANA</span>
					<a href="https://knapesolutions.com" className="hover:text-[var(--bone)]">
						KNAPESOLUTIONS.COM
					</a>
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						className="ms-auto hover:text-[var(--bone)]"
					>
						{CONTACT_EMAIL.toUpperCase()}
					</a>
				</div>
			</footer>
		</div>
	);
}

export const Route = createFileRoute("/workboat-2026")({
	component: RouteComponent,
});
