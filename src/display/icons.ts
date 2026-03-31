// Lucide icon SVG paths for use with Satori.
// Each function returns a Satori-compatible element tree.

type SatoriElement = {
  type: string;
  props: Record<string, unknown>;
};

function svgIcon(
  paths: string[],
  size: number,
  strokeWidth = 1.5,
): SatoriElement {
  return {
    type: "svg",
    props: {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { width: size, height: size },
      children: paths.map((d) => ({
        type: "path",
        props: { d },
      })),
    },
  };
}

export function iconBrain(size: number): SatoriElement {
  return svgIcon(
    [
      "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
      "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
      "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
      "M17.599 6.5a3 3 0 0 0 .399-1.375",
      "M6.003 5.125A3 3 0 0 0 6.401 6.5",
      "M3.477 10.896a4 4 0 0 1 .585-.396",
      "M19.938 10.5a4 4 0 0 1 .585.396",
      "M6 18a4 4 0 0 1-1.967-.516",
      "M19.967 17.484A4 4 0 0 1 18 18",
    ],
    size,
  );
}

export function iconCalendar(size: number): SatoriElement {
  return svgIcon(
    [
      "M16 2v4",
      "M8 2v4",
      "M3 10h18",
      "M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5Z",
    ],
    size,
  );
}

export function iconCheckSquare(size: number): SatoriElement {
  return svgIcon(
    [
      "m9 11 3 3L22 4",
      "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    ],
    size,
  );
}

export function iconCheck(size: number): SatoriElement {
  return svgIcon(["M20 6 9 17l-5-5"], size, 2.5);
}

export function iconSun(size: number): SatoriElement {
  return svgIcon(
    [
      "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
      "M12 2v2",
      "M12 20v2",
      "m4.93 4.93 1.41 1.41",
      "m17.66 17.66 1.41 1.41",
      "M2 12h2",
      "M20 12h2",
      "m6.34 17.66-1.41 1.41",
      "m19.07 4.93-1.41 1.41",
    ],
    size,
  );
}

export function iconCloud(size: number): SatoriElement {
  return svgIcon(
    ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
    size,
  );
}

export function iconCloudRain(size: number): SatoriElement {
  return svgIcon(
    [
      "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
      "M16 14v6",
      "M8 14v6",
      "M12 16v6",
    ],
    size,
  );
}

export function iconCloudSnow(size: number): SatoriElement {
  return svgIcon(
    [
      "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
      "M8 15h.01",
      "M8 19h.01",
      "M12 17h.01",
      "M12 21h.01",
      "M16 15h.01",
      "M16 19h.01",
    ],
    size,
  );
}

export function iconCloudLightning(size: number): SatoriElement {
  return svgIcon(
    [
      "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973",
      "m13 12-3 5h4l-3 5",
    ],
    size,
  );
}

export function weatherIcon(code: number, size: number): SatoriElement {
  if (code === 0) return iconSun(size);
  if (code >= 1 && code <= 3) return iconCloud(size);
  if (code === 45 || code === 48) return iconCloud(size);
  if (code >= 51 && code <= 67) return iconCloudRain(size);
  if (code >= 71 && code <= 77) return iconCloudSnow(size);
  if (code >= 80 && code <= 82) return iconCloudRain(size);
  if (code >= 95) return iconCloudLightning(size);
  return iconCloud(size);
}
