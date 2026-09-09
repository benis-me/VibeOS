import { expect, test } from "bun:test";
import { resolveDiskAddress } from "./files.ts";

test("address navigation handles root, nested and relative locations without escaping the disk", () => {
  expect(resolveDiskAddress("/", "Documents/Notes")).toBe("");
  expect(resolveDiskAddress("../Medias", "Documents")).toBe("Medias");
  expect(resolveDiskAddress("./Notes/../readme.txt", "Documents")).toBe("Documents/readme.txt");
  expect(resolveDiskAddress("/Documents//中文/", "Medias")).toBe("Documents/中文");
  expect(resolveDiskAddress("Documents", "Medias")).toBe("Documents");
  expect(() => resolveDiskAddress("../../runtime", "Documents")).toThrow("path");
});
