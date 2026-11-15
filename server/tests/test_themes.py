"""The public theme contract is a small, typed set of inert design tokens."""

from __future__ import annotations

import unittest

from mio_server.themes import (
    BUILTIN,
    COLOR_TOKENS,
    LENGTH_TOKENS,
    PAPER,
    ThemeError,
    parse_theme,
    resolved,
)


def theme(tokens: dict[str, str]):
    return parse_theme({"id": "custom-ui", "name": "Custom UI", "mode": "light", "tokens": tokens})


class ThemeTokenTests(unittest.TestCase):
    def test_existing_builtin_palettes_remain_valid(self):
        for builtin in BUILTIN:
            with self.subTest(theme=builtin.id):
                self.assertEqual(parse_theme(builtin.model_dump()), builtin)
                self.assertTrue(set(PAPER.tokens) <= set(resolved(builtin)))

    def test_semantic_overrides_survive_resolution_without_freezing_palette_defaults(self):
        tokens = {
            "accent": "#123456",
            "button-hover": "transparent",
            "control-surface": "rgba(240,245,240,.5)",
            "radius-control": "0.375rem",
            "radius-card": "0",
            "control-height": "40px",
            "space-panel": "1.25rem",
            "shadow-sm": "0 8px 24px rgb(0 0 0 / 20%)",
        }
        result = resolved(theme(tokens))
        for name, value in tokens.items():
            with self.subTest(token=name):
                self.assertEqual(result[name], value)
        self.assertEqual(result["bg"], PAPER.tokens["bg"])
        self.assertNotIn("button-primary", result)
        self.assertNotIn("button-border", result)
        self.assertNotIn("surface-panel", result)

    def test_shared_token_types_accept_their_documented_value_forms(self):
        for name in COLOR_TOKENS:
            with self.subTest(token=name):
                self.assertEqual(theme({name: " transparent "}).tokens[name], "transparent")
        for name in LENGTH_TOKENS:
            for value in ("1px", "2.5rem"):
                with self.subTest(token=name, value=value):
                    self.assertEqual(theme({name: value}).tokens[name], value)
        for value in (
            "#abc",
            "#abcd",
            "#aabbcc",
            "#aabbccdd",
            "rgb(0 255 128 / 25%)",
            "rgba(0, 255, 128, .25)",
            "hsl(120deg 25% 50% / .5)",
            "hsla(120, 25%, 50%, .5)",
        ):
            with self.subTest(color=value):
                self.assertEqual(theme({"button-hover": value}).tokens["button-hover"], value)
        for value in (
            "none",
            "0 8px 24px rgba(0,0,0,.4)",
            "inset 0 1px 0 #fff",
            "#fff 0 0 0 1px",
            "0 1px 2px rgb(0 0 0 / .14), 0 4px 14px rgb(0 0 0 / .1)",
            "0 -.5rem 1rem -1px transparent",
        ):
            with self.subTest(shadow=value):
                self.assertEqual(theme({"shadow-sm": value}).tokens["shadow-sm"], value)

    def test_values_cannot_escape_their_typed_contract(self):
        invalid = {
            "button-hover": [
                "url(https://example.invalid/image)",
                "var(--accent)",
                "inherit",
                "red; color: white",
                "#fff}body{display:none}",
                "rgb(0 0 0); background:url(x)",
                "#abcde",
                "rgb(256 0 0)",
                "rgba(0,0,0,2)",
                "hsl(120 40 50)",
                "rgb(1 2)",
            ],
            "button-height": ["0", "-1px", "40", "100%", "2em", "257px", "17rem"],
            "radius-card": ["-1px", "257px", "calc(1rem + 1px)", "8px 12px"],
            "space-panel": ["-1rem", "300px", "auto", "env(safe-area-inset-top)"],
            "shadow-sm": [
                "url(x)",
                "0 0 0 var(--accent)",
                "0 0 2px expression(alert(1))",
                "0 0 -2px #fff",
                "0 0 1025px #fff",
                "0 0 1px #fff; color:red",
                "0 0 1px #fff,",
                "0 0 0 #fff, 0 0 0 #fff, 0 0 0 #fff, 0 0 0 #fff, 0 0 0 #fff",
            ],
            "position": ["fixed"],
            "font-family": ["sans-serif"],
        }
        for name, values in invalid.items():
            for value in values:
                with self.subTest(token=name, value=value), self.assertRaises(ThemeError):
                    theme({name: value})


if __name__ == "__main__":
    unittest.main()
