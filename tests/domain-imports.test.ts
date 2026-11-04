import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ALLOWED_PACKAGES = ["zod"];

const DOMAIN_DIR = path.resolve(process.cwd(), "src/domain");

type Violation = { specifier: string; reason: string };

function collectSpecifiers(source: string, fileName: string) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: { specifier: string | null }[] = [];

  const literal = (node: ts.Node | undefined) =>
    node && ts.isStringLiteralLike(node) ? node.text : null;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) found.push({ specifier: literal(node.moduleSpecifier) });
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        found.push({ specifier: literal(node.moduleReference.expression) });
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      found.push({ specifier: ts.isLiteralTypeNode(arg) ? literal(arg.literal) : null });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) found.push({ specifier: literal(node.arguments[0]) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function findViolations(source: string, filePath: string): Violation[] {
  const dir = path.dirname(filePath);
  const violations: Violation[] = [];
  for (const { specifier } of collectSpecifiers(source, filePath)) {
    if (specifier === null) {
      violations.push({ specifier: "<non-literal>", reason: "specifier is not a string literal" });
    } else if (specifier.startsWith(".")) {
      const resolved = path.resolve(dir, specifier);
      if (resolved !== DOMAIN_DIR && !resolved.startsWith(DOMAIN_DIR + path.sep)) {
        violations.push({ specifier, reason: "relative path escapes src/domain" });
      }
    } else if (!ALLOWED_PACKAGES.includes(specifier)) {
      violations.push({ specifier, reason: "not in the allowlist" });
    }
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("domain imports allowlist", () => {
  it("every file under src/domain imports only allowed modules", () => {
    const violations = listSourceFiles(DOMAIN_DIR).flatMap((file) =>
      findViolations(readFileSync(file, "utf8"), file).map(
        (v) => `${path.relative(process.cwd(), file)}: ${v.specifier} (${v.reason})`,
      ),
    );
    expect(violations).toEqual([]);
  });

  const sample = path.join(DOMAIN_DIR, "money/sample.ts");

  it.each([
    ["@prisma/client", 'import { PrismaClient } from "@prisma/client";'],
    ["next/server", 'import { NextResponse } from "next/server";'],
    ["react", 'import React from "react";'],
    ["a relative path escaping src/domain", 'import { db } from "../../server/db";'],
    ["a deeply escaping relative path", 'export * from "../../../../etc/passwd";'],
    ["a dynamic import of a package", 'const m = await import("@prisma/client");'],
    ["a dynamic import with a computed specifier", "const m = await import(name);"],
    ["a require() call", 'const fs = require("node:fs");'],
    ["an import() type", 'type T = import("react").FC;'],
  ])("rejects %s", (_label, source) => {
    expect(findViolations(source, sample)).not.toEqual([]);
  });

  it.each([
    ["an allowlisted package", 'import { z } from "zod";'],
    ["a sibling relative import", 'import { a } from "./other";'],
    ["a parent relative import inside src/domain", 'import { a } from "../ledger/entry";'],
  ])("accepts %s", (_label, source) => {
    expect(findViolations(source, sample)).toEqual([]);
  });
});
