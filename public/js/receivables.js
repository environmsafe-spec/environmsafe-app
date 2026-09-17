/* EnvironmSafe — receivables page.
   Holds no secrets: it asks /api/receivables, which does the work server-side
   behind the staff session cookie. */

(function () {
  "use strict";

  var gate = document.getElementById("gate");
  var shell = document.getElementById("shell");
  var loading = document.getElementById("loading");
  var errorBox = document.getElementById("error");
  var report = document.getElementById("report");

  /* ---------------------------------------------------------- sign in -- */

  function showGate() {
    gate.hidden = false;
    shell.hidden = true;
    document.getElementById("passcode").focus();
  }

  function showReport() {
    gate.hidden = true;
    shell.hidden = false;
    load();
  }

  document.getElementById("gate-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var button = document.getElementById("gate-submit");
    var message = document.getElementById("gate-error");
    var passcode = document.getElementById("passcode").value;

    button.disabled = true;
    button.textContent = "Signing in…";
    message.textContent = "";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: passcode })
    })
      .then(function (response) {
        if (response.ok) return showReport();
        return response.json().then(function (body) {
          message.textContent = (body && body.error) || "Could not sign in.";
        });
      })
      .catch(function () {
        message.textContent = "Could not reach the server. Check the connection.";
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Sign in";
      });
  });

  document.getElementById("signout").addEventListener("click", function () {
    fetch("/api/login", { method: "DELETE" }).then(function () {
      location.reload();
    });
  });

  document.getElementById("refresh").addEventListener("click", load);

  /* ------------------------------------------------------- formatting -- */

  function money(value) {
    return Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Ageing buckets, and the only place the page uses colour. Anything past
  // 90 days is the reason someone opened this page.
  function ageCell(days) {
    if (days === null || days === undefined) return '<span class="age">—</span>';
    var tone = days >= 90 ? "late" : days >= 30 ? "due" : "fresh";
    return '<span class="age age--' + tone + '">' + days + "d</span>";
  }

  function bucketOf(days) {
    if (days === null || days === undefined) return "No date";
    if (days < 30) return "Under 30 days";
    if (days < 60) return "30 to 59 days";
    if (days < 90) return "60 to 89 days";
    if (days < 180) return "90 to 179 days";
    return "180 days and over";
  }

  var BUCKET_ORDER = ["Under 30 days", "30 to 59 days", "60 to 89 days",
                      "90 to 179 days", "180 days and over", "No date"];

  function escapeHtml(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ----------------------------------------------------------- render -- */

  function render(data) {
    document.getElementById("asof").textContent = "as at " + data.asOf;

    var quality = document.getElementById("quality");
    quality.innerHTML = "";
    (data.quality || []).forEach(function (note) {
      var item = document.createElement("li");
      item.textContent = note;
      quality.appendChild(item);
    });
    document.getElementById("quality-card").hidden = !(data.quality || []).length;

    /* Open invoices */
    var open = data.openInvoices || [];
    document.getElementById("open-count").textContent =
      open.length ? "(" + open.length + ")" : "";
    var body = document.querySelector("#open-table tbody");
    // data-label lets the same markup read as a table on a laptop and as a
    // labelled card on a phone, so age and amount are never scrolled off.
    body.innerHTML = open.map(function (invoice) {
      return "<tr>" +
        '<td class="wrap" data-label="Customer">' + escapeHtml(invoice.customer) + "</td>" +
        '<td class="num" data-label="Age">' + ageCell(invoice.ageDays) + "</td>" +
        '<td class="num" data-label="Amount">' + escapeHtml(invoice.currency) + " " + money(invoice.amount) + "</td>" +
        '<td class="wrap" data-label="Reference">' + escapeHtml(invoice.reference) + "</td>" +
        '<td data-label="Date">' + escapeHtml(invoice.date) + "</td>" +
        '<td data-label="Status">' + escapeHtml(invoice.status) + "</td>" +
        "</tr>";
    }).join("");
    document.getElementById("open-table").hidden = !open.length;
    document.getElementById("open-empty").hidden = Boolean(open.length);

    /* Ageing — counted per bucket, totalled per currency within it. */
    var buckets = {};
    open.forEach(function (invoice) {
      var name = bucketOf(invoice.ageDays);
      var bucket = buckets[name] || (buckets[name] = { count: 0, byCurrency: {} });
      bucket.count += 1;
      bucket.byCurrency[invoice.currency] =
        (bucket.byCurrency[invoice.currency] || 0) + Number(invoice.amount || 0);
    });
    var ageingBody = document.querySelector("#ageing-table tbody");
    ageingBody.innerHTML = BUCKET_ORDER.filter(function (name) {
      return buckets[name];
    }).map(function (name) {
      var bucket = buckets[name];
      var amounts = Object.keys(bucket.byCurrency).sort().map(function (code) {
        return escapeHtml(code) + " " + money(bucket.byCurrency[code]);
      }).join("<br>");
      return '<tr><td data-label="Age">' + name + '</td><td class="num" data-label="Invoices">' +
        bucket.count + '</td><td class="num" data-label="Amounts">' + amounts + "</td></tr>";
    }).join("") || '<tr><td colspan="3">Nothing to age.</td></tr>';

    /* Per customer */
    var customers = data.customers || [];
    document.getElementById("cust-count").textContent =
      customers.length ? "(" + customers.length + ")" : "";
    document.getElementById("customers").innerHTML = customers.map(function (customer) {
      var codes = Object.keys(customer.currencies).sort();
      var rows = codes.map(function (code) {
        var figures = customer.currencies[code];
        return '<div class="cust__row">' +
          '<span class="cust__ccy">' + escapeHtml(code) + "</span>" +
          "<span>" + money(figures.invoiced) + "</span>" +
          "<span>" + money(figures.received) + "</span>" +
          "<span>" + money(figures.net) + "</span>" +
          "</div>";
      }).join("");

      var aliases = customer.aliases.length > 1
        ? " · also written: " + customer.aliases.slice(1).map(escapeHtml).join(", ")
        : "";

      return '<div class="cust">' +
        '<div class="cust__name">' + escapeHtml(customer.name) + "</div>" +
        '<div class="cust__meta">' + customer.invoices + " invoice(s), " +
          customer.payments + " payment(s)" + aliases + "</div>" +
        '<div class="cust__rows">' +
          '<div class="cust__row cust__row--head"><span>Currency</span>' +
          "<span>Invoiced</span><span>Received</span><span>Difference</span></div>" +
          rows +
        "</div></div>";
    }).join("") || '<p class="rec__empty">No customers found in the ledger.</p>';

    document.getElementById("source").textContent =
      "Source: " + data.source.name + " — sheet “" + data.source.sheet +
      "”. " + data.totals.realRows + " real rows read (" +
      data.totals.invoiceRows + " invoices, " + data.totals.paymentRows +
      " payments); " + data.totals.blankRows + " blank rows ignored.";
  }

  /* ------------------------------------------------------------- load -- */

  function load() {
    loading.hidden = false;
    errorBox.hidden = true;
    report.hidden = true;
    document.getElementById("refresh").disabled = true;

    fetch("/api/receivables", { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (response.status === 401) {
          showGate();
          return null;
        }
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body && body.error ? body.error : "HTTP " + response.status);
          return body;
        });
      })
      .then(function (data) {
        if (!data) return;
        render(data);
        loading.hidden = true;
        report.hidden = false;
      })
      .catch(function (failure) {
        loading.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = failure.message || "Could not read the ledger.";
      })
      .then(function () {
        document.getElementById("refresh").disabled = false;
      });
  }

  /* Ask the server whether this browser already holds a session, so a signed-in
     person is not made to type the passcode again on every visit. */
  fetch("/api/login")
    .then(function (response) { return response.json(); })
    .then(function (body) { return body && body.signedIn ? showReport() : showGate(); })
    .catch(showGate);
})();
