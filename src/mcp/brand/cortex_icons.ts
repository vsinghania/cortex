import type { Icon } from '@modelcontextprotocol/server';

/**
 * The Cortex logo for MCP clients and the public hosts' favicon, rendered from
 * web/public/favicon.svg. Embedded rather than linked: the MCP spec has clients accept
 * icons only as data: URIs or from the server's own origin, and the notes MCP server does
 * not know the public URL it is reached at.
 */
export class CortexIcons {
  private static readonly SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#04080d"/>
  <path d="M16 5.2l9.6 5.55v11.1L16 27.4l-9.6-5.55v-11.1z" fill="none" stroke="#00c5c5" stroke-width="2.6" stroke-linejoin="round"/>
</svg>`;

  private static readonly PNG_64_BASE64 =
    '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';

  /** 32 and 48 px PNGs in an ICO container. */
  private static readonly FAVICON_ICO_BASE64 =
    'AAABAAIAICAAAAEAIAC9BAAAJgAAADAwAAABACAA9gYAAOMEAACJUE5HDQoaCgAAAA1JSERSAAAAIAAAACAIBgAAAHN6evQAAASE' +
    'SURBVHja7VdbbJRFFP5m/t12WzGErZZ2izYBa2KKtq4owoMmVImiInQBC6WCTQwPJhoJqCEm8maIROOrMYrAYkW6FJRL0PKgCZeg' +
    '1SooF+GJtoawbU16b3fGc2b2X9q9sUUTeOAkk0z+f84535y5fN8ITYYk6+jsxPFjJ9C0ew/27tsPIYRpkzEOy23pi4tRt2IZ5s1/' +
    'HGWBQNqBCbt6NarXb3hLF5fcQ6C8GiJfe3x3/qfGMTgWx+TYnGO8CbcC5y/8hZfq6vFr2ykIbwEcx8H/abFYDHp0ENXBR/FVUxj3' +
    'V9xnvhsA0Wg3ahY+i/a2n+HxFeYWcWwMUMr2pQQ8ntzchgZQFXwErUcOoajID8kf39/yASU/lVtyTjo0BF1+L9Smt03jPn9LAMpi' +
    'nINzcU5TAdpwuio4F93RKGS2svNKDQ8D06ZBLauFWhECTcH+Y9/dzZB7IkBPD5CfT5Ezb1pFy+En3/a2kxCRln26dkmIkBVkTj4y' +
    'Ykqsn1oAtbYBetasa4DY4gnFxYuQ23ZAfH/ULlFeXpalGESkpRnOWExsPnv2XPrZE1KMjkJXV0G9sxFq9UrA77el+/0MnC1bIb9r' +
    'BWbMAIrvNtXRTz4BXVkJ0dVF5e2wlZAytaBKE8YYhMy7Q8vkAe7sKLBqWAW16BmgkPYHV7WjCzL8JeQ3B4CBATue/qkXnoOqJ4Bl' +
    'peQP808ePAy5Yxdw+XLaZVG0Z4Q5q8nJvV6oJYuhVtUBJcU2YF+fSSrDTQDNbkJAF3BpKYGoM2AwZYoF/PcVyF1NkC37TTWTQaQC' +
    'oEDq5dVQ69+wO5sHHTsO+dkXEKfP2OOWabPyktHa69mVUI1roOfPs999PsgPP4bcvtMCH38q0u72kun2SPX3w9n6EcSRVl60FOcU' +
    'Y2DUxB9/wtm4CXphDWIb3rSbkWOm3vqQGc86l6r3H4gffrR9WpacjcfyqWBfimH8M9wRMmsgdmT0kySiyfhK3GS7DeA2gFscAHME' +
    'n1++Qidr7MO+Ut4AANfpriLE3nuX2O0BupaH7VV7fe1lxrIP+3KMCTGTL0/pyd+cchUTTeo5QWDqVKC8HPrpGiM+mO/R22uv3OQL' +
    'xiWk6cVQ614lLnkdqKiw3HGFCGl72FB0Mo+kp2MuX4CYraHeUnFBQZyKOyF3EhV/e9BSscsNnJgp+flFVjOUBSyDDg7GKTkMdHal' +
    'XOeGjkPLV+pIcwROsnqhKiBGzPYwiZHGV6DnzmG4cTFymthxG7HkCTt50vyqcS30g7NdtQFx8ica8znEL+00a6qCZ+LMY6SyakO1' +
    'OUgylmOEPCHHZs6Emd7IKETrUZuvZgHd+zw7IqBLl67JMq5kBlnmSrLcRKm7vn4WpCGo5SHTT9Ar74fuHsivWZg2m342YTpelMoA' +
    'qZg1vNb0aMjKbCQq0NcP+cmncNa9BnHgkK0ONe7zN/7HY8zYbKqYcnFOzn1jDxNWvFyYqocsvvbf4vLm+o+T5IdJ4m147vwFXR18' +
    'TPNjSXgLc3v7OT7bchjLMTk25+Bcrt06j9Ob9Tz/F5AwqzfSKD1DAAAAAElFTkSuQmCCiVBORw0KGgoAAAANSUhEUgAAADAAAAAw' +
    'CAYAAABXAvmHAAAGvUlEQVR42u1aW2yURRT+ZnZhe4FCiyVEQdryICq0BdPSGIQgEgUNV0EMAaoNpUBp1DdjSEwM3l40vcBagnIJ' +
    'UVFuPngJIAGqQYihFFQwoS2pQS5yKwF62f3Hc2a6u13a7v79tyVEO0mbv7O7Z75z5nxn53xToWggwmhsbMSJmpOorq7Bxs824dRv' +
    'v0MIgd4YDGXM44+h4JV8ZGdnIitzLJKSkiJ+RnTlQG1dHbzeDdi5aw9q6+uhWpsBtwdutwu9OXw+P/1qhujnQUZaGubOmYWiomXI' +
    'SE+35wD/WV6xHu+sfQ+XL5zXoF1uNwTu7WBQfp9PO5M67EGseetNFK9a0WH3wxxobm7GqpLXsbGyUkfA5XLhfhh+v19nQEFhISpK' +
    'P4LH4+nogGVZKFxRTOC9cHkSey3PY+GHv/kWOVGEyvXlkFLqeRl4wzpvpY58j4FvaeWENj/8HONgTIyNMTLWsB2orz+HnLyJuHL1' +
    'auxpw4BpN1VeLqwX55kofb0D4shReqB4EZ9iTachKSk4dqQKaWkj4Q5E/5+L5+GOS3RumUCjpQUqIwNW/mKoZ54G+vc3i5IzYt+P' +
    'kJu2QtTWmnkpHS3DAWasjPnD99dC3GhsVOOeyEMdlU2Xk+gwhYj8SEnWEbfmz6XnFDMXqA+ckkw82mH51U69I7h6zcw5SFeuTulU' +
    'Vo//egTicNVPavKUaZBOUocijn79dLStpRT1URlmjneDgbXtgJ5jZzjqNCfO1kJu3qp3Ba2tofd1Z8MplQ4e2Av38ePVsKhESVdC' +
    'N/Lcz2GAGpcN69V8qAk5BnRTk3ndQ4DuNFG0d5jFXpgBxMfRrrTo96iRD8P/9hqI6c9BfroJgjDQ9hM/7AeRMTN2kTk+V508ecoe' +
    'eQN5PmI4rMWLoGY8Z9KAI8yDU1AKIuwxA6z6hMmy7CzjaB47qgzReXDkKdXEt99Dbt0G0fCXbX4wmTPHjoFweQYoW2WTc3rgQFiz' +
    'Z8J6eQEwdGgoz4OpcdYQdd8BAtkankJuTrUphuCjRoWnGgfh0iXIz7dD7v4GuHnTzNn4bhDuuIEqalmkRdSkiRTFpVCjR5u8pQiE' +
    'k3OHJiiudUHOANmTkzXRrfnzwsnOGUB8EqdP0+5thjhUZeajFJbIDlCuq5EjYK0sgpr4pAHV2hrafnoWe/cbQtbW2dv+YLlNN8Sf' +
    'NlUDD6YhP3Nkq36GXOeFONcQkRtdO8DekzF/+cdQWZnA7dttee7ShGPiyY2U50ePOfuCCnzh5ebAKsjXBYELgy4QPBISIE7UwFX8' +
    'mglaF2nujhipwYOghj8Uqi68zX9fgNyyDfK7H8z2OyiBQcJzBCkALgJqTX8W1pJFwLBhJj25WvHahAEXL5m1OxnSVuVpW1DU1cO9' +
    'vBhy524z7xR8+8E2yBbbZNu8RnA3A2tHikM3TlPA9evAlStAXFzPHjXZNttk27xGN76du3cg4Vx3eIbpLfu9iObejD4H+hzoc6DP' +
    'gT4H+hz4HznAh6tAO9g7yq6tA5wzB9hwaqrWffTxupsLRbXNx2e2TWt0x3ZkBxRChysWWOl87veWwVq+DBgwwDgS+XohuqbENsgW' +
    '22Tbugfw+0OHO+XUAf4w9brizJ9AfLw54rLhxERYhQXwf1IB6/kZoabdiabEwScb2hbZZNvBXpvW1GsThkgn1Mg9MRujxpubeYsl' +
    'lIC2E5RQpO6odGtpV9tprylxK5mbE86tgKbEUgs199qBCJJPdFmFnSDjWtvhBSfkhi8Y0HaoxeRWUzQ0dN7cBzWlEbp1VNRCdtSU' +
    'KCC/HDUBYU2J5yKA17JK1vhcVWNH2GqTEa2pU6Dyl3SUEbW2cxnyiy8hd92l7QQ0pTkzYS18CRia2ommVAuxaQvk/gO25MagsFVa' +
    'VqFKVpfAHZdgj3ScQsmDo2g7Z4y2c/CQ+djkSW2a0iNRNKXrJoVstJS+ptsoLSt1KO7a1XYOHm5z4Kme0ZQ6EXdjk9ejaTvtpcUe' +
    '1JTay+syiXJz3tzZUL5mZ9oO5y9rOyVvQL77AXD+glEYGBgD5x9+5jl6jd/D79Xg2UEHdxKMlTEz9p67Ygpon0RQa+ECIuwsYNAg' +
    '89qNG0TsPUTw7ZroTi82AuRtf8UUvKUsX+fF6lXFcHniY7vkY4JSfqtHR0OxE1yrCbz447ThRgx3cOam8g7KKspRvLLI2O61a1bm' +
    'R+BIwKBjvNzr6prVHTo5SH2JzKNHLroZcIyg26eNuegu0hhlu2oVVrf4BnyDt0LX1weGpFCtvUWB9EHh3g+lN9GnMTAWxsTYPHdd' +
    'fPz3/tnj7nG//7vNv89Yxr3dF82NAAAAAElFTkSuQmCC';

  private constructor() {}

  /** For an MCP server's `serverInfo.icons`: a PNG every client must render, and the SVG for those that scale. */
  static forMcp(): Icon[] {
    return [
      { src: `data:image/png;base64,${CortexIcons.PNG_64_BASE64}`, mimeType: 'image/png', sizes: ['64x64'] },
      { src: `data:image/svg+xml;base64,${Buffer.from(CortexIcons.SVG).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] }
    ];
  }

  static faviconIco(): Buffer {
    return Buffer.from(CortexIcons.FAVICON_ICO_BASE64, 'base64');
  }
}
