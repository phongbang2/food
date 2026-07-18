#!/usr/bin/env python3
"""Desktop review dashboard for the An Sap Sai Gon collector."""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import threading
import webbrowser
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, W, X, Y, messagebox
from tkinter import ttk
import tkinter as tk

import food_collector as collector
import trend_collector as trends


APP_DIR = Path(__file__).resolve().parent
ENV_FILE = APP_DIR / ".env"
CATEGORY_LABELS = {
    "all": "Tất cả quán ăn",
    "restaurant": "Nhà hàng",
    "cafe": "Quán cà phê",
    "fastfood": "Fastfood",
    "bakery": "Tiệm bánh / bánh mì",
}
CATEGORY_VALUES = list(CATEGORY_LABELS.values())
CATEGORY_BY_LABEL = {label: key for key, label in CATEGORY_LABELS.items()}


class CollectorApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Ăn Sập Sài Gòn • Food Data Desk")
        self.geometry("1320x820")
        self.minsize(1080, 680)
        self.configure(bg="#f4f7fb")

        collector.load_env(ENV_FILE)
        self.candidates: list[dict] = []
        self.busy = False
        self.district_var = tk.StringVar(value="Quận 2")
        self.category_var = tk.StringVar(value=CATEGORY_LABELS["all"])
        self.limit_var = tk.StringVar(value="10")
        self.status_var = tk.StringVar(value="Sẵn sàng")
        self.count_var = tk.StringVar(value="Chưa có kết quả")
        self.selected_var = tk.StringVar(value="Chưa chọn địa điểm")
        self.detail_name_var = tk.StringVar(value="Chưa chọn địa điểm")
        self.detail_meta_var = tk.StringVar(value="Chọn một dòng để xem thông tin chi tiết")
        self.detail_address_var = tk.StringVar(value="—")
        self.detail_food_var = tk.StringVar(value="—")
        self.detail_hours_var = tk.StringVar(value="—")
        self.detail_source_var = tk.StringVar(value="—")
        self.webhook_var = tk.StringVar(value="")

        self._configure_style()
        self._build_ui()
        self._refresh_config_status()

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("App.TFrame", background="#f4f7fb")
        style.configure("Header.TFrame", background="#102a43")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Section.TLabel", background="#ffffff", foreground="#102a43", font=("Segoe UI", 13, "bold"))
        style.configure("Title.TLabel", background="#102a43", foreground="#ffffff", font=("Segoe UI", 24, "bold"))
        style.configure("Brand.TLabel", background="#102a43", foreground="#ff9f68", font=("Segoe UI", 9, "bold"))
        style.configure("Subtitle.TLabel", background="#102a43", foreground="#c9d7e6", font=("Segoe UI", 10))
        style.configure("Card.TLabel", background="#ffffff", foreground="#243b53", font=("Segoe UI", 10))
        style.configure("Muted.TLabel", background="#ffffff", foreground="#829ab1", font=("Segoe UI", 9))
        style.configure("Status.TLabel", background="#d9f7e9", foreground="#147d50", font=("Segoe UI", 9, "bold"), padding=(10, 5))
        style.configure("WarningStatus.TLabel", background="#fff0df", foreground="#b45309", font=("Segoe UI", 9, "bold"), padding=(10, 5))
        style.configure("FieldLabel.TLabel", background="#ffffff", foreground="#627d98", font=("Segoe UI", 9, "bold"))
        style.configure("Accent.TButton", foreground="#ffffff", background="#f26b45", font=("Segoe UI", 10, "bold"), padding=(15, 9))
        style.map("Accent.TButton", background=[("active", "#d95736"), ("disabled", "#f5b6a5")])
        style.configure("Dark.TButton", foreground="#ffffff", background="#183b56", font=("Segoe UI", 9, "bold"), padding=(11, 7))
        style.map("Dark.TButton", background=[("active", "#245679")])
        style.configure("Soft.TButton", foreground="#245679", background="#eef5fb", font=("Segoe UI", 9, "bold"), padding=(10, 7))
        style.map("Soft.TButton", background=[("active", "#dcecf8")])
        style.configure("Danger.TButton", foreground="#a33a2b", background="#fff0ed", font=("Segoe UI", 9, "bold"), padding=(10, 7))
        style.map("Danger.TButton", background=[("active", "#ffe0da")])
        style.configure("TEntry", padding=(8, 7), fieldbackground="#fbfdff")
        style.configure("TCombobox", padding=(7, 6), fieldbackground="#fbfdff")
        style.configure("Treeview", rowheight=37, font=("Segoe UI", 10), background="#ffffff", fieldbackground="#ffffff", foreground="#243b53")
        style.configure("Treeview.Heading", background="#edf3f8", foreground="#486581", font=("Segoe UI", 9, "bold"), padding=(8, 8))
        style.map("Treeview", background=[("selected", "#dceefc")], foreground=[("selected", "#102a43")])
        style.configure("TProgressbar", troughcolor="#e7eef5", background="#f26b45", lightcolor="#f26b45", darkcolor="#f26b45")

    def _build_ui(self) -> None:
        root = ttk.Frame(self, style="App.TFrame", padding=(24, 20))
        root.pack(fill=BOTH, expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(2, weight=1)

        self._build_header(root)
        self._build_search_card(root)
        self._build_content(root)
        self._build_footer(root)

    def _build_header(self, root: ttk.Frame) -> None:
        header = ttk.Frame(root, style="Header.TFrame", padding=(24, 20))
        header.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        header.columnconfigure(0, weight=1)

        left = ttk.Frame(header, style="Header.TFrame")
        left.grid(row=0, column=0, sticky=W)
        ttk.Label(left, text="ĂN SẬP SÀI GÒN  •  DATA DESK", style="Brand.TLabel").pack(anchor=W)
        ttk.Label(left, text="Thu thập & duyệt quán ăn", style="Title.TLabel").pack(anchor=W, pady=(4, 2))
        ttk.Label(
            left,
            text="Tìm nguồn công khai, kiểm tra từng địa điểm rồi đưa vào hàng chờ Review.",
            style="Subtitle.TLabel",
        ).pack(anchor=W)

        right = ttk.Frame(header, style="Header.TFrame")
        right.grid(row=0, column=1, sticky="e")
        self.config_status = ttk.Label(right, text="Đang kiểm tra cấu hình", style="WarningStatus.TLabel")
        self.config_status.pack(anchor="e", pady=(0, 10))
        ttk.Button(right, text="Tìm review tham khảo", command=self.open_trend_window, style="Soft.TButton").pack(anchor="e", pady=(0, 7))
        ttk.Button(right, text="Mở trang Review  ↗", command=self.open_review_web, style="Soft.TButton").pack(anchor="e")

    def _build_search_card(self, root: ttk.Frame) -> None:
        card = ttk.Frame(root, style="Card.TFrame", padding=(18, 15))
        card.grid(row=1, column=0, sticky="ew", pady=(0, 14))
        card.columnconfigure(1, weight=1)
        card.columnconfigure(3, weight=1)

        ttk.Label(card, text="TÌM DỮ LIỆU ĐỊA ĐIỂM", style="Muted.TLabel").grid(row=0, column=0, columnspan=6, sticky=W, pady=(0, 10))

        ttk.Label(card, text="Quận / khu vực", style="FieldLabel.TLabel").grid(row=1, column=0, sticky=W, padx=(0, 8))
        ttk.Label(card, text="Loại địa điểm", style="FieldLabel.TLabel").grid(row=1, column=2, sticky=W, padx=(16, 8))
        ttk.Label(card, text="Số lượng", style="FieldLabel.TLabel").grid(row=1, column=4, sticky=W, padx=(16, 8))

        ttk.Entry(card, textvariable=self.district_var, width=20).grid(row=2, column=0, sticky="ew", padx=(0, 14), pady=(5, 0))
        ttk.Combobox(card, textvariable=self.category_var, values=CATEGORY_VALUES, state="readonly", width=22).grid(
            row=2, column=2, sticky="ew", padx=(16, 14), pady=(5, 0)
        )
        ttk.Spinbox(card, from_=1, to=100, textvariable=self.limit_var, width=8).grid(
            row=2, column=4, sticky=W, padx=(16, 16), pady=(5, 0)
        )

        self.search_button = ttk.Button(card, text="⌕  Tìm quán", command=self.search, style="Accent.TButton")
        self.search_button.grid(row=2, column=5, sticky="e", pady=(5, 0))

    def _build_content(self, root: ttk.Frame) -> None:
        content = ttk.Frame(root, style="App.TFrame")
        content.grid(row=2, column=0, sticky="nsew")
        content.columnconfigure(0, weight=3)
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)

        results = ttk.Frame(content, style="Card.TFrame", padding=14)
        results.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        results.columnconfigure(0, weight=1)
        results.rowconfigure(2, weight=1)

        result_head = ttk.Frame(results, style="Card.TFrame")
        result_head.grid(row=0, column=0, sticky="ew", pady=(0, 3))
        result_head.columnconfigure(0, weight=1)
        ttk.Label(result_head, text="Kết quả tìm kiếm", style="Section.TLabel").grid(row=0, column=0, sticky=W)
        ttk.Label(result_head, textvariable=self.count_var, style="Muted.TLabel").grid(row=0, column=1, sticky="e")

        ttk.Label(
            results,
            text="Chọn một hoặc nhiều dòng. Nhấp đúp để mở vị trí trên Google Maps.",
            style="Muted.TLabel",
        ).grid(row=1, column=0, sticky=W, pady=(0, 9))

        table_frame = ttk.Frame(results, style="Card.TFrame")
        table_frame.grid(row=2, column=0, sticky="nsew")
        table_frame.columnconfigure(0, weight=1)
        table_frame.rowconfigure(0, weight=1)

        columns = ("name", "type", "food", "district", "street", "status")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="extended")
        headings = {
            "name": ("Tên quán", 250),
            "type": ("Phân loại", 120),
            "food": ("Món", 145),
            "district": ("Quận", 95),
            "street": ("Địa chỉ", 300),
            "status": ("Trạng thái", 110),
        }
        for column, (heading, width) in headings.items():
            self.tree.heading(column, text=heading)
            self.tree.column(column, width=width, anchor=W, stretch=column in {"name", "street"})

        yscroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        xscroll = ttk.Scrollbar(table_frame, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        self.tree.tag_configure("duplicate", foreground="#9aa5b1")
        self.tree.tag_configure("needs", foreground="#b45309")
        self.tree.tag_configure("submitted", foreground="#147d50")
        self.tree.bind("<<TreeviewSelect>>", self._selection_changed)
        self.tree.bind("<Double-1>", self._open_map_for_row)

        detail = ttk.Frame(content, style="Card.TFrame", padding=18)
        detail.grid(row=0, column=1, sticky="nsew")
        detail.columnconfigure(0, weight=1)

        ttk.Label(detail, text="Chi tiết địa điểm", style="Section.TLabel").grid(row=0, column=0, sticky=W)
        ttk.Label(detail, textvariable=self.selected_var, style="Muted.TLabel").grid(row=1, column=0, sticky=W, pady=(4, 18))
        name_label = ttk.Label(detail, textvariable=self.detail_name_var, style="Section.TLabel")
        name_label.grid(row=2, column=0, sticky=W)
        ttk.Label(detail, textvariable=self.detail_meta_var, style="Muted.TLabel").grid(row=3, column=0, sticky=W, pady=(4, 18))

        self._detail_row(detail, 4, "ĐỊA CHỈ", self.detail_address_var)
        self._detail_row(detail, 5, "MÓN / PHÂN LOẠI", self.detail_food_var)
        self._detail_row(detail, 6, "GIỜ MỞ CỬA", self.detail_hours_var)
        self._detail_row(detail, 7, "NGUỒN", self.detail_source_var)

        detail_buttons = ttk.Frame(detail, style="Card.TFrame")
        detail_buttons.grid(row=8, column=0, sticky="ew", pady=(22, 0))
        ttk.Button(detail_buttons, text="Mở Google Maps", command=self._open_map_for_row, style="Dark.TButton").pack(fill=X, pady=(0, 7))
        ttk.Button(detail_buttons, text="Copy địa chỉ", command=self._copy_address, style="Soft.TButton").pack(fill=X)

    def _detail_row(self, parent: ttk.Frame, row: int, title: str, variable: tk.StringVar) -> None:
        ttk.Label(parent, text=title, style="FieldLabel.TLabel").grid(row=row, column=0, sticky=W, pady=(0, 3))
        ttk.Label(parent, textvariable=variable, style="Card.TLabel", wraplength=280, justify=LEFT).grid(
            row=row + 1, column=0, sticky=W, pady=(0, 13)
        )

    def _build_footer(self, root: ttk.Frame) -> None:
        footer = ttk.Frame(root, style="Card.TFrame", padding=(14, 12))
        footer.grid(row=3, column=0, sticky="ew", pady=(14, 0))
        footer.columnconfigure(0, weight=1)

        left = ttk.Frame(footer, style="Card.TFrame")
        left.grid(row=0, column=0, sticky=W)
        self.progress = ttk.Progressbar(left, mode="indeterminate", length=180)
        self.progress.pack(side=LEFT, padx=(0, 12))
        ttk.Label(left, textvariable=self.status_var, style="Card.TLabel").pack(side=LEFT)

        right = ttk.Frame(footer, style="Card.TFrame")
        right.grid(row=0, column=1, sticky="e")
        ttk.Button(right, text="Chọn quán mới", command=self.select_new, style="Soft.TButton").pack(side=LEFT, padx=(0, 7))
        ttk.Button(right, text="Bỏ chọn", command=self.clear_selection, style="Danger.TButton").pack(side=LEFT, padx=(0, 10))
        self.approve_button = ttk.Button(
            right,
            text="✓  Approve → Đưa vào Review",
            command=self.approve_selected,
            style="Accent.TButton",
        )
        self.approve_button.pack(side=LEFT)

        log_card = ttk.Frame(root, style="App.TFrame")
        log_card.grid(row=4, column=0, sticky="ew", pady=(10, 0))
        self.log_text = tk.Text(
            log_card,
            height=4,
            wrap="word",
            bg="#102a43",
            fg="#d9e2ec",
            insertbackground="#ffffff",
            relief="flat",
            padx=10,
            pady=8,
            font=("Consolas", 9),
        )
        self.log_text.pack(fill=X)
        self.log_text.configure(state="disabled")

    def _refresh_config_status(self) -> None:
        url_ok = bool(os.environ.get("APPS_SCRIPT_URL", "").strip())
        token_ok = bool(os.environ.get("IMPORT_TOKEN", "").strip())
        if url_ok and token_ok:
            self.config_status.configure(text="● Webhook Review sẵn sàng", style="Status.TLabel")
            self._log("Đã đọc .env: có thể Approve vào hàng chờ Review.")
        else:
            self.config_status.configure(text="● Thiếu cấu hình webhook", style="WarningStatus.TLabel")
            self._log("Thiếu APPS_SCRIPT_URL hoặc IMPORT_TOKEN: vẫn có thể tìm, chưa thể Approve.")

    def _log(self, text: str) -> None:
        if not text:
            return
        self.log_text.configure(state="normal")
        self.log_text.insert(END, text.rstrip() + "\n")
        self.log_text.see(END)
        self.log_text.configure(state="disabled")

    def _set_busy(self, busy: bool, message: str = "") -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.search_button.configure(state=state)
        self.approve_button.configure(state=state)
        if busy:
            self.progress.start(10)
        else:
            self.progress.stop()
        if message:
            self.status_var.set(message)

    def _selection_changed(self, _event=None) -> None:
        selection = self.tree.selection()
        count = len(selection)
        self.selected_var.set(f"{count} địa điểm đang được chọn" if count else "Chưa chọn địa điểm")
        self.status_var.set(f"Đã chọn {count} quán." if count else "Sẵn sàng")
        if selection:
            self._show_detail(self.candidates[int(selection[0])])

    def _show_detail(self, item: dict) -> None:
        self.detail_name_var.set(item.get("name") or "Không có tên")
        self.detail_meta_var.set(
            f"{item.get('type') or 'Chưa phân loại'}  •  {item.get('district') or 'Chưa rõ quận'}"
        )
        self.detail_address_var.set(item.get("street") or "Chưa rõ địa chỉ")
        self.detail_food_var.set(item.get("food") or "Đang cập nhật")
        self.detail_hours_var.set(item.get("hours") or "Chưa có dữ liệu")
        self.detail_source_var.set(item.get("source") or "—")

    def _parse_limit(self) -> int:
        try:
            value = max(1, min(100, int(self.limit_var.get())))
            self.limit_var.set(str(value))
            return value
        except ValueError:
            self.limit_var.set("10")
            return 10

    def search(self) -> None:
        if self.busy:
            return
        district = self.district_var.get().strip()
        category = CATEGORY_BY_LABEL.get(self.category_var.get().strip(), "all")
        limit = self._parse_limit()
        self._set_busy(True, "Đang tìm dữ liệu công khai…")
        self.count_var.set("Đang xử lý…")
        self._log(f"Tìm {district or 'toàn TP.HCM'} • {CATEGORY_LABELS.get(category, category)} • tối đa {limit}")

        args = argparse.Namespace(district=district, category=category, limit=limit)

        def worker() -> None:
            output = io.StringIO()
            try:
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    candidates, endpoint = collector.collect(args)
                self.after(0, self._show_results, candidates, endpoint, output.getvalue())
            except Exception as error:
                self.after(0, self._show_error, f"{error}\n{output.getvalue()}")

        threading.Thread(target=worker, daemon=True).start()

    def _show_results(self, candidates: list[dict], endpoint: str, logs: str) -> None:
        self._set_busy(False, "Đã tìm xong.")
        self.candidates = candidates
        self.tree.delete(*self.tree.get_children())

        for index, item in enumerate(candidates):
            status = (
                "Đã đưa vào Review"
                if item.get("_submitted")
                else "Đã có / trùng"
                if item.get("duplicate")
                else "Thiếu địa chỉ"
                if item.get("needsVerification")
                else "Quán mới"
            )
            tag = (
                ("submitted",)
                if item.get("_submitted")
                else ("duplicate",)
                if item.get("duplicate")
                else ("needs",)
                if item.get("needsVerification")
                else ()
            )
            self.tree.insert(
                "",
                END,
                iid=str(index),
                values=(
                    item.get("name", ""),
                    item.get("type", ""),
                    item.get("food", ""),
                    item.get("district", ""),
                    item.get("street", ""),
                    status,
                ),
                tags=tag,
            )

        fresh = sum(not item.get("duplicate") and not item.get("needsVerification") for item in candidates)
        needs_check = sum(not item.get("duplicate") and item.get("needsVerification") for item in candidates)
        duplicate = sum(bool(item.get("duplicate")) for item in candidates)
        self.count_var.set(
            f"{len(candidates)} kết quả  •  {fresh} quán đủ địa chỉ  •  "
            f"{needs_check} thiếu địa chỉ  •  {duplicate} trùng"
        )
        self._log(logs or f"Nguồn: {endpoint}")
        self._log(f"Hoàn tất từ nguồn: {endpoint}")
        self.tree.selection_remove(self.tree.selection())

    def _show_error(self, error: str) -> None:
        self._set_busy(False, "Có lỗi khi tìm dữ liệu.")
        self.count_var.set("Không có kết quả")
        self._log(error)
        messagebox.showerror("Không thể tìm quán", error[:2000])

    def select_new(self) -> None:
        ids = [
            str(index)
            for index, item in enumerate(self.candidates)
            if not item.get("duplicate")
            and not item.get("_submitted")
            and not item.get("needsVerification")
        ]
        self.tree.selection_set(ids)
        self._selection_changed()

    def clear_selection(self) -> None:
        self.tree.selection_remove(self.tree.selection())
        self._selection_changed()

    def _selected_item(self) -> dict | None:
        selection = self.tree.selection()
        return self.candidates[int(selection[0])] if selection else None

    def _open_map_for_row(self, _event=None) -> None:
        item = self._selected_item()
        if not item:
            messagebox.showinfo("Chưa chọn địa điểm", "Hãy chọn một dòng trước.")
            return
        url = item.get("mapUrl") or item.get("source")
        if url:
            webbrowser.open(url)

    def _copy_address(self) -> None:
        item = self._selected_item()
        if not item:
            messagebox.showinfo("Chưa chọn địa điểm", "Hãy chọn một dòng trước.")
            return
        address = item.get("street") or ""
        self.clipboard_clear()
        self.clipboard_append(address)
        self.update()
        self.status_var.set("Đã copy địa chỉ vào clipboard.")

    def approve_selected(self) -> None:
        if self.busy:
            return
        selection = self.tree.selection()
        selected = [
            self.candidates[int(item_id)]
            for item_id in selection
            if not self.candidates[int(item_id)].get("duplicate")
            and not self.candidates[int(item_id)].get("_submitted")
            and not self.candidates[int(item_id)].get("needsVerification")
        ]
        if not selected:
            messagebox.showinfo("Chưa chọn quán mới", "Hãy chọn ít nhất một quán mới trước.")
            return
        if not os.environ.get("APPS_SCRIPT_URL") or not os.environ.get("IMPORT_TOKEN"):
            messagebox.showwarning("Thiếu cấu hình", "Hãy điền APPS_SCRIPT_URL và IMPORT_TOKEN trong collector/.env.")
            return
        if not messagebox.askyesno("Xác nhận Approve", f"Đưa {len(selected)} quán vào hàng chờ Review trên web?"):
            return

        self._set_busy(True, "Đang đưa quán vào hàng chờ Review…")
        self._log(f"Đang gửi {len(selected)} quán vào Apps Script…")

        def worker() -> None:
            try:
                response = collector.push_to_apps_script(selected)
                self.after(0, self._show_push_result, response, selected)
            except Exception as error:
                self.after(0, self._show_push_error, str(error))

        threading.Thread(target=worker, daemon=True).start()

    def _show_push_result(self, response: dict, submitted: list[dict]) -> None:
        self._set_busy(False, "Đã gửi xong.")
        result = response.get("result", response) if isinstance(response, dict) else {}
        added = int(result.get("added", 0) or 0)
        skipped = int(result.get("skipped", 0) or 0)
        message = result.get("message", "Đã gửi dữ liệu.")
        if added:
            for item in submitted:
                item["_submitted"] = True
            for item_id in self.tree.selection():
                self.tree.item(item_id, values=(*self.tree.item(item_id, "values")[:-1], "Đã đưa vào Review"), tags=("submitted",))
        self._log(f"{message} • thêm: {added}, bỏ qua: {skipped}")
        self.count_var.set(f"Đã gửi {added} quán vào Review  •  bỏ qua {skipped}")
        messagebox.showinfo("Hoàn tất", f"{message}\n\nThêm: {added}\nBỏ qua: {skipped}")

    def _show_push_error(self, error: str) -> None:
        self._set_busy(False, "Không gửi được dữ liệu.")
        self._log(f"Lỗi gửi Apps Script: {error}")
        messagebox.showerror("Lỗi gửi Apps Script", error[:2000])

    def open_trend_window(self) -> None:
        """Show public review leads; exact place data still comes from OSM."""
        window = tk.Toplevel(self)
        window.title("Ăn Sập Sài Gòn • Review tham khảo")
        window.geometry("1120x650")
        window.minsize(900, 560)
        window.configure(bg="#f4f7fb")
        window.transient(self)

        district_var = tk.StringVar(value=self.district_var.get().strip())
        keyword_var = tk.StringVar(value="quán ngon")
        trend_status = tk.StringVar(value="Chưa tìm review")
        trend_items: list[dict] = []

        outer = ttk.Frame(window, style="App.TFrame", padding=20)
        outer.pack(fill=BOTH, expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(2, weight=1)

        header = ttk.Frame(outer, style="Header.TFrame", padding=(20, 16))
        header.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="REVIEW & TÍN HIỆU THAM KHẢO", style="Brand.TLabel").grid(row=0, column=0, sticky=W)
        ttk.Label(header, text="Tìm bài review, sau đó đối chiếu với quán thật từ OSM", style="Title.TLabel").grid(
            row=1, column=0, sticky=W, pady=(3, 2)
        )
        ttk.Label(
            header,
            text="OSM = tên + địa chỉ quán • RSS = bài review tham khảo • không tự cào TikTok",
            style="Subtitle.TLabel",
        ).grid(row=2, column=0, sticky=W)

        controls = ttk.Frame(outer, style="Card.TFrame", padding=14)
        controls.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        controls.columnconfigure(1, weight=1)
        controls.columnconfigure(3, weight=2)
        ttk.Label(controls, text="Quận / khu vực", style="FieldLabel.TLabel").grid(row=0, column=0, sticky=W, padx=(0, 8))
        ttk.Label(controls, text="Từ khóa", style="FieldLabel.TLabel").grid(row=0, column=2, sticky=W, padx=(14, 8))
        ttk.Entry(controls, textvariable=district_var, width=20).grid(row=1, column=0, columnspan=2, sticky="ew", padx=(0, 14), pady=(5, 0))
        ttk.Entry(controls, textvariable=keyword_var).grid(row=1, column=2, columnspan=2, sticky="ew", padx=(14, 14), pady=(5, 0))
        search_button = ttk.Button(controls, text="⌕  Tìm review", style="Accent.TButton")
        search_button.grid(row=1, column=4, sticky="e", pady=(5, 0))

        results = ttk.Frame(outer, style="Card.TFrame", padding=14)
        results.grid(row=2, column=0, sticky="nsew")
        results.columnconfigure(0, weight=1)
        results.rowconfigure(1, weight=1)
        result_head = ttk.Frame(results, style="Card.TFrame")
        result_head.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        result_head.columnconfigure(0, weight=1)
        ttk.Label(result_head, text="Review / link để kiểm tra", style="Section.TLabel").grid(row=0, column=0, sticky=W)
        ttk.Label(result_head, textvariable=trend_status, style="Muted.TLabel").grid(row=0, column=1, sticky="e")

        table_frame = ttk.Frame(results, style="Card.TFrame")
        table_frame.grid(row=1, column=0, sticky="nsew")
        table_frame.columnconfigure(0, weight=1)
        table_frame.rowconfigure(0, weight=1)
        columns = ("title", "source", "published")
        trend_tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="browse")
        trend_tree.heading("title", text="Tiêu đề / review")
        trend_tree.heading("source", text="Nguồn")
        trend_tree.heading("published", text="Ngày đăng")
        trend_tree.column("title", width=680, anchor=W, stretch=True)
        trend_tree.column("source", width=190, anchor=W)
        trend_tree.column("published", width=170, anchor=W)
        trend_scroll = ttk.Scrollbar(table_frame, orient="vertical", command=trend_tree.yview)
        trend_tree.configure(yscrollcommand=trend_scroll.set)
        trend_tree.grid(row=0, column=0, sticky="nsew")
        trend_scroll.grid(row=0, column=1, sticky="ns")

        footer = ttk.Frame(outer, style="Card.TFrame", padding=(0, 12, 0, 0))
        footer.grid(row=3, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)
        progress = ttk.Progressbar(footer, mode="indeterminate", length=180)
        progress.grid(row=0, column=0, sticky=W)
        ttk.Label(
            footer,
            text="Đây là bài review, không phải bản ghi quán. Hãy dùng OSM/Google Maps để xác minh tên + địa chỉ trước khi Approve.",
            style="Muted.TLabel",
        ).grid(row=1, column=0, sticky=W, pady=(8, 0))
        action_frame = ttk.Frame(footer, style="Card.TFrame")
        action_frame.grid(row=0, column=1, rowspan=2, sticky="e")
        exact_button = ttk.Button(action_frame, text="Tìm quán chính xác (OSM)", style="Accent.TButton")
        exact_button.pack(side=LEFT, padx=(0, 7))
        open_button = ttk.Button(action_frame, text="Mở link đã chọn", style="Dark.TButton")
        open_button.pack(side=LEFT, padx=(0, 7))
        copy_button = ttk.Button(action_frame, text="Copy link", style="Soft.TButton")
        copy_button.pack(side=LEFT)

        def selected_item() -> dict | None:
            selection = trend_tree.selection()
            if not selection:
                return None
            index = int(selection[0])
            return trend_items[index] if 0 <= index < len(trend_items) else None

        def open_selected() -> None:
            item = selected_item()
            if not item or not item.get("link"):
                messagebox.showinfo("Chưa chọn tín hiệu", "Hãy chọn một kết quả trước.")
                return
            webbrowser.open(item["link"])

        def copy_selected() -> None:
            item = selected_item()
            if not item or not item.get("link"):
                messagebox.showinfo("Chưa chọn tín hiệu", "Hãy chọn một kết quả trước.")
                return
            window.clipboard_clear()
            window.clipboard_append(item["link"])
            window.update()
            trend_status.set("Đã copy link nguồn.")

        def on_result(result: dict) -> None:
            progress.stop()
            search_button.configure(state="normal")
            trend_items.clear()
            trend_items.extend(result.get("items", []))
            trend_tree.delete(*trend_tree.get_children())
            for index, item in enumerate(trend_items):
                trend_tree.insert(
                    "",
                    END,
                    iid=str(index),
                    values=(
                        item.get("title", ""),
                        item.get("source", ""),
                        item.get("published", ""),
                    ),
                )
            sources = ", ".join(result.get("sources", [])) or "không xác định"
            errors = result.get("errors", [])
            suffix = f" • {len(errors)} nguồn lỗi" if errors else ""
            trend_status.set(f"{len(trend_items)} bài review • {sources}{suffix}")
            self._log(f"Review tham khảo: {len(trend_items)} kết quả từ {sources}.")
            for error in errors[:2]:
                self._log(f"RSS cảnh báo: {error}")

        def on_error(error: str) -> None:
            progress.stop()
            search_button.configure(state="normal")
            trend_items.clear()
            trend_tree.delete(*trend_tree.get_children())
            trend_status.set("Không lấy được review")
            self._log(f"Lỗi RSS review: {error}")
            messagebox.showerror("Không thể tìm review", error[:2000])

        def safe_after(callback, *args) -> None:
            try:
                if window.winfo_exists():
                    window.after(0, callback, *args)
            except tk.TclError:
                pass

        def search_trends() -> None:
            if str(search_button["state"]) == "disabled":
                return
            district = district_var.get().strip()
            keyword = keyword_var.get().strip()
            search_button.configure(state="disabled")
            progress.start(10)
            trend_status.set("Đang đọc review từ RSS công khai…")

            def worker() -> None:
                try:
                    result = trends.search_trends(district, keyword, 40)
                    safe_after(on_result, result)
                except Exception as error:
                    safe_after(on_error, str(error))

            threading.Thread(target=worker, daemon=True).start()

        def open_exact_search() -> None:
            self.district_var.set(district_var.get().strip())
            window.destroy()
            self.search()

        search_button.configure(command=search_trends)
        exact_button.configure(command=open_exact_search)
        open_button.configure(command=open_selected)
        copy_button.configure(command=copy_selected)
        trend_tree.bind("<Double-1>", lambda _event: open_selected())
        search_trends()

    def open_review_web(self) -> None:
        url = os.environ.get("APPS_SCRIPT_URL", "").strip()
        if not url:
            messagebox.showwarning("Thiếu URL", "Hãy điền APPS_SCRIPT_URL trong collector/.env.")
            return
        webbrowser.open(url)


if __name__ == "__main__":
    CollectorApp().mainloop()
