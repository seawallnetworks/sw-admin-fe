// Menu and brand icons, drawn inline: 24x24 stroke icons in currentColor, so they
// take the menu's text colour (and its active/hover colours) like the labels do.
// No icon package and no external files: nothing to fetch, nothing the CSP refuses.

import { h, type FunctionalComponent } from 'vue'

function strokeIcon(paths: string[]): FunctionalComponent {
  const icon: FunctionalComponent = () =>
    h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        width: '1em',
        height: '1em',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      paths.map((d) => h('path', { d })),
    )
  return icon
}

/** Four tiles of different heights. */
export const DashboardIcon = strokeIcon([
  'M4 4h7v9H4z',
  'M13 4h7v5h-7z',
  'M13 11h7v9h-7z',
  'M4 15h7v5H4z',
])

/** A list with a check and a cross: rules that allow or deny. */
export const AclIcon = strokeIcon([
  'M10 6h10',
  'M10 12h10',
  'M10 18h10',
  'M3.5 6l1.5 1.5L7.5 5',
  'M4 16.5l3 3',
  'M7 16.5l-3 3',
])

/** A shield. */
export const DdosIcon = strokeIcon(['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M12 8v8'])

/** Waves: a flood of requests. */
export const HttpFloodIcon = strokeIcon([
  'M3 8c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0',
  'M3 13c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0',
  'M3 18c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0',
])

/** A gauge: request rate. */
export const CcIcon = strokeIcon(['M4 17a8 8 0 1 1 16 0', 'M12 17l4-5', 'M4 20h16'])

/** A padlock. */
export const BruteForceIcon = strokeIcon(['M5 11h14v10H5z', 'M8 11V8a4 4 0 0 1 8 0v3', 'M12 15v2'])

/** A page of text. */
export const LogsIcon = strokeIcon(['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 12h7', 'M9 16h7'])

/** The Seawall mark: a shield with a wave across it. Used when the sidebar is collapsed. */
export const BrandIcon = strokeIcon([
  'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z',
  'M7.5 12.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0',
])
