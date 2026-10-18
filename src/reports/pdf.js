"use strict";
const fs = require("fs"),
  path = require("path"),
  PDFDocument = require("pdfkit"),
  QRCode = require("qrcode"),
  { ordinal } = require("../utilities/ordinal");
const GREEN = "#073D30",
  GOLD = "#C79A32",
  CREAM = "#F8F6EF",
  INK = "#17231F",
  MUTED = "#657069",
  BORDER = "#D7DDD8",
  fallbackCrest = path.resolve(
    __dirname,
    "../../public/assets/images/growthengine-demo-crest.png",
  );
const text = (value) => (value == null ? "—" : String(value)),
  score = (value) =>
    value == null || value === "" || !Number.isFinite(Number(value))
      ? "—"
      : String(Number(value)),
  publishedDate = (value) =>
    value
      ? new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(value))
      : "—";
function logoFor(school) {
  if (school.logo_path && fs.existsSync(school.logo_path))
    return school.logo_path;
  return /growthengine demonstration school/i.test(school.name || "") &&
    fs.existsSync(fallbackCrest)
    ? fallbackCrest
    : null;
}
function line(doc, y, color = GOLD, width = 1) {
  doc.moveTo(38, y).lineTo(557, y).lineWidth(width).strokeColor(color).stroke();
}
function sectionTitle(doc, title, y) {
  doc.roundedRect(38, y, 519, 22, 3).fill(GREEN);
  doc
    .font("Times-Bold")
    .fontSize(10.5)
    .fillColor("#FFFFFF")
    .text(title, 50, y + 5.5, { characterSpacing: 0.8 });
  return y + 22;
}
function positionInClass(position, classSize) {
  const label = ordinal(position);
  return classSize ? `${label} out of ${classSize}` : label;
}
function reportPdf(report) {
  return new Promise(async (resolve, reject) => {
    try {
      const {
          school,
          student,
          session,
          term,
          classRow,
          arm,
          results = [],
          gradingRules = [],
          publication = {},
          summary: reportSummary = {},
        } = report,
        qr = report.verificationUrl
          ? await QRCode.toBuffer(report.verificationUrl, {
              type: "png",
              width: 360,
              margin: 3,
              errorCorrectionLevel: "M",
              color: { dark: GREEN, light: "#FFFFFF" },
            })
          : null,
        doc = new PDFDocument({
          size: "A4",
          margin: 38,
          bufferPages: true,
          info: {
            Title: `${student.admission_number} report card`,
            Author: school.name,
          },
        }),
        chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const crest = logoFor(school);
      if (crest)
        try {
          doc.image(crest, 41, 17, {
            fit: [82, 82],
            align: "center",
            valign: "center",
          });
        } catch {}
      if (crest)
        doc
          .moveTo(132, 27)
          .lineTo(132, 88)
          .lineWidth(1)
          .strokeColor(GOLD)
          .stroke();
      const identityX = crest ? 140 : 58,
        identityWidth = crest ? 407 : 479,
        schoolNameY = 32;
      doc
        .font("Times-Bold")
        .fontSize(16)
        .fillColor(GREEN)
        .text(text(school.name).toUpperCase(), identityX, schoolNameY, {
          width: identityWidth,
          align: "center",
          lineGap: 0,
        });
      const schoolNameHeight = doc.heightOfString(
          text(school.name).toUpperCase(),
          {
            width: identityWidth,
            lineGap: 0,
          },
        ),
        mottoY = schoolNameY + schoolNameHeight + 5;
      if (school.motto)
        doc
          .font("Times-Bold")
          .fontSize(10.5)
          .fillColor(GOLD)
          .text(text(school.motto).toUpperCase(), identityX, mottoY, {
            width: identityWidth,
            align: "center",
            characterSpacing: 2.5,
          });
      const identityBottom = Math.max(101, mottoY + (school.motto ? 13 : 0)),
        bandY = identityBottom + 8;
      line(doc, identityBottom, GOLD, 1.5);
      doc.roundedRect(38, bandY, 519, 55, 5).fillAndStroke(GREEN, GOLD);
      doc
        .font("Times-Bold")
        .fontSize(21)
        .fillColor("#FFFFFF")
        .text("ACADEMIC REPORT CARD", 50, bandY + 9, {
          width: 495,
          align: "center",
          characterSpacing: 0.6,
        });
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#F3E5BD")
        .text(
          `${text(session.name).toUpperCase()} ACADEMIC SESSION  |  ${text(term.name).toUpperCase()}`,
          50,
          bandY + 35,
          { width: 495, align: "center" },
        );
      let y = sectionTitle(doc, "STUDENT INFORMATION", bandY + 61);
      doc.roundedRect(38, y, 519, 76, 4).fillAndStroke("#FFFFFF", BORDER);
      doc
        .moveTo(297, y + 8)
        .lineTo(297, y + 68)
        .lineWidth(0.7)
        .strokeColor(BORDER)
        .stroke();
      const fullName = [
          student.first_name,
          student.middle_name,
          student.last_name,
        ]
          .filter(Boolean)
          .join(" "),
        details = [
          ["Name", fullName, 51, y + 9],
          ["Academic Session", session.name, 317, y + 9],
          ["Admission No.", student.admission_number, 51, y + 26],
          ["Term", term.name, 317, y + 26],
          ["Class", classRow.name, 51, y + 43],
          ["Number of Subjects", results.length, 317, y + 43],
          ["Arm", arm?.name || "—", 51, y + 60],
          ["Students in Class", reportSummary.classSize, 317, y + 60],
        ];
      for (const [label, value, x, top] of details) {
        doc
          .font("Helvetica")
          .fontSize(8.2)
          .fillColor(MUTED)
          .text(`${label}:`, x, top, { width: 97 });
        doc
          .font("Times-Bold")
          .fontSize(10)
          .fillColor(INK)
          .text(text(value), x + 100, top - 1, {
            width: x < 200 ? 142 : 132,
            lineBreak: false,
          });
      }
      y = sectionTitle(doc, "ACADEMIC PERFORMANCE", y + 86);
      const widths = [25, 143, 40, 40, 45, 47, 42, 88, 49],
        headers = [
          "S/N",
          "SUBJECT",
          "CA1\n/20",
          "CA2\n/20",
          "EXAM\n/60",
          "TOTAL\n/100",
          "GRADE",
          "REMARK",
          "POSITION",
        ],
        tableX = 38,
        headerHeight = 26;
      doc.rect(tableX, y, 519, headerHeight).fill(CREAM);
      let offset = 0;
      headers.forEach((header, index) => {
        doc
          .rect(tableX + offset, y, widths[index], headerHeight)
          .stroke(BORDER);
        doc
          .font("Helvetica-Bold")
          .fontSize(index === 1 ? 8 : 7)
          .fillColor(GREEN)
          .text(
            header,
            tableX + offset + 2,
            y + (header.includes("\n") ? 4 : 9),
            {
              width: widths[index] - 4,
              align: index === 1 ? "left" : "center",
              lineGap: 1,
            },
          );
        offset += widths[index];
      });
      y += headerHeight;
      results.forEach((result, index) => {
        const rowHeight = Math.max(
          24,
          doc.heightOfString(text(result.subject_name), {
            width: widths[1] - 7,
            lineGap: 0,
          }) + 7,
        );
        if (y + rowHeight > 650) {
          doc.addPage({ size: "A4", margin: 38 });
          y = sectionTitle(doc, "ACADEMIC PERFORMANCE — CONTINUED", 45);
        }
        doc
          .rect(tableX, y, 519, rowHeight)
          .fill(index % 2 ? "#FBFCFA" : "#FFFFFF");
        const values = [
          index + 1,
          result.subject_name,
          score(result.ca1_score),
          score(result.ca2_score),
          score(result.examination_score),
          score(result.total_score),
          result.grade,
          result.remark || "—",
          ordinal(result.subject_position),
        ];
        offset = 0;
        values.forEach((value, column) => {
          doc
            .rect(tableX + offset, y, widths[column], rowHeight)
            .stroke(BORDER);
          doc
            .font(column === 1 ? "Helvetica-Bold" : "Helvetica")
            .fontSize(column === 1 ? 8.4 : column === 7 ? 7.4 : 8.2)
            .fillColor(INK)
            .text(text(value), tableX + offset + 3, y + (rowHeight - 10) / 2, {
              width: widths[column] - 6,
              align: column === 1 ? "left" : "center",
              lineGap: 0,
            });
          offset += widths[column];
        });
        y += rowHeight;
      });
      if (y > 590) {
        doc.addPage({ size: "A4", margin: 38 });
        y = 45;
      }
      const summary = results[0] || {};
      y += 10;
      const boxHeight = Math.max(112, 36 + gradingRules.length * 12);
      doc.roundedRect(38, y, 228, boxHeight, 5).fillAndStroke(CREAM, GOLD);
      doc
        .font("Times-Bold")
        .fontSize(10.5)
        .fillColor(GREEN)
        .text("PERFORMANCE SUMMARY", 50, y + 11, { characterSpacing: 0.4 });
      doc
        .moveTo(50, y + 29)
        .lineTo(254, y + 29)
        .lineWidth(0.6)
        .strokeColor(BORDER)
        .stroke();
      [
        ["Total Subjects", results.length],
        ["Student Average", score(summary.student_average)],
        [
          "Overall Position",
          positionInClass(summary.overall_position, reportSummary.classSize),
        ],
      ].forEach(([label, value], index) => {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(MUTED)
          .text(label, 50, y + 39 + index * 24, { width: 112 });
        doc
          .font("Times-Bold")
          .fontSize(11)
          .fillColor(INK)
          .text(text(value), 170, y + 38 + index * 24, {
            width: 80,
            align: "right",
          });
        if (index < 2)
          doc
            .moveTo(50, y + 58 + index * 24)
            .lineTo(254, y + 58 + index * 24)
            .lineWidth(0.5)
            .strokeColor(BORDER)
            .stroke();
      });
      doc.roundedRect(276, y, 281, boxHeight, 5).fillAndStroke("#FFFFFF", GOLD);
      doc
        .font("Times-Bold")
        .fontSize(10.5)
        .fillColor(GREEN)
        .text("GRADE KEY", 288, y + 11, { characterSpacing: 0.4 });
      doc
        .moveTo(288, y + 29)
        .lineTo(545, y + 29)
        .lineWidth(0.6)
        .strokeColor(BORDER)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(7.2)
        .fillColor(MUTED)
        .text("GRADE", 288, y + 33, { width: 45 })
        .text("SCORE RANGE", 340, y + 33, { width: 78 })
        .text("REMARK", 426, y + 33, { width: 117 });
      doc
        .moveTo(334, y + 31)
        .lineTo(334, y + boxHeight - 7)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();
      doc
        .moveTo(420, y + 31)
        .lineTo(420, y + boxHeight - 7)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();
      gradingRules.forEach((rule, index) => {
        const top = y + 47 + index * 11;
        doc
          .moveTo(288, top - 3)
          .lineTo(545, top - 3)
          .lineWidth(0.35)
          .strokeColor(BORDER)
          .stroke();
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(INK)
          .text(text(rule.grade), 288, top, { width: 40 });
        doc
          .font("Helvetica")
          .text(
            `${Number(rule.minimum_score)} – ${Number(rule.maximum_score)}`,
            340,
            top,
            { width: 74 },
          )
          .text(text(rule.remark), 426, top, { width: 117 });
      });
      y += boxHeight + 10;
      const infoHeight = 70;
      doc
        .roundedRect(38, y, 519, infoHeight, 5)
        .fillAndStroke("#FFFFFF", BORDER);
      [177, 316, 445].forEach((x) =>
        doc
          .moveTo(x, y + 10)
          .lineTo(x, y + 60)
          .lineWidth(0.6)
          .strokeColor(BORDER)
          .stroke(),
      );
      [
        ["Form Teacher", report.formTeacher || "—"],
        ["Date Published", publishedDate(publication.publishedAt)],
      ].forEach(([label, value], index) => {
        const x = [52, 193, 332][index];
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(label.toUpperCase(), x, y + 18, { width: 116 });
        doc
          .font("Times-Bold")
          .fontSize(10)
          .fillColor(INK)
          .text(text(value), x, y + 34, { width: 116 });
      });
      if (qr) {
        doc.image(qr, 474, y + 3, { fit: [61, 61] });
        doc
          .font("Helvetica-Bold")
          .fontSize(6.2)
          .fillColor(GREEN)
          .text("Scan to Verify", 460, y + 61, { width: 90, align: "center" });
      }
      const footerY = 775;
      doc
        .moveTo(38, footerY - 5)
        .lineTo(557, footerY - 5)
        .lineWidth(1.4)
        .strokeColor(GOLD)
        .stroke();
      doc.rect(0, footerY, 595.28, 46.89).fill(GREEN);
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#FFFFFF")
        .text("GENERATED SECURELY BY SAIRS", 38, footerY + 14, {
          width: 519,
          align: "center",
          characterSpacing: 1.5,
        });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
module.exports = { reportPdf, logoFor, publishedDate };
