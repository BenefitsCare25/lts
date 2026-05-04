-- Add employeeCategories column to ExtractionDraft.
-- Stores unique Category values extracted from an optional employee listing
-- uploaded before AI extraction runs, so the AI can name benefit groups using
-- the same labels that employees have in their data field employee.category.
-- Default empty array; all existing rows treated as "no listing uploaded".

ALTER TABLE "ExtractionDraft"
  ADD COLUMN "employeeCategories" TEXT[] NOT NULL DEFAULT '{}';
