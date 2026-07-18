#!/usr/bin/env python3
"""Desktop review app for the An Sap Sai Gon collector.

Run with:
    py collector_gui.py
or double-click run_gui.bat.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import threading
import time
import webbrowser
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, W, X, Y, BooleanVar, StringVar, messagebox
from tkinter import ttk
import tkinter as tk

import food_collector as collector


APP_DIR = Path(__file__).resolve().parent
ENV_FILE = APP_DIR / ".env"
CATEGORY_LABELS = {
    "all": "Tất cả quán ăn",
    "restaurant": "Nhà hàng",
    "cafe": "Quán cà phê",
    "fastfood": "Fastfood",
    "bakery": "Tiệm bánh / bánh mì",
}
CATEGORY_VALUES = list(CATEGORY_LABELS)


class CollectorApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("An Sập Sài Gòn • Thu thập & duyệt quán")
        self.geometry("1220x760")
        self.minsize(980, 620)
        self.configure(bg="#fff8f4")

        collector.load_env(ENV_FILE)
        self.candidates: list[dict] = []
        self.busy = False
        self.status_var = StringVar(value="Sẵn sàng")
        self.count_var = StringVar(value="Chưa có kết quả")
        self.district_var = StringVar(value="Quận 2")
        self.category_var = StringVar(value="all")
        self.limit_var = StringVar(value="10")

        self._configure_style()
        self._build_ui()
        self._refresh_config_status()

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("App.TFrame", background="#fff8f4")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Title.TLabel", background="#fff8f4", foreground="#17212b", font=("Segoe UI", 22, "bold"))
        style.configure("Muted.TLabel", background="#fff8f4", foreground="#6b7280", font=("Segoe UI", 10))
        style.configure("Card.TLabel", background="#ffffff", foreground="#17212b", font=("Segoe UI", 10))
        style.configure("CardHeading.TLabel", background="#ffffff", foreground="#17212b", font=("Segoe UI", 13, "bold"))
        style.configure("Accent.TButton", foreground="#ffffff", background="#f46b45", font=("Segoe UI", 10, "bold"))
        style.map("Accent.TButton", background=[("active", "#dc5937")])
        style.configure("Treeview", rowheight=34, font=("Segoe UI", 10), background="#ffffff", fieldbackground="#ffffff")
        style.configure("Treeview.Heading", font=("Segoe UI", 10, "bold"))
        style.configure("TCombobox", padding=5)
        style.configure("TProgressbar", troughcolor="#f5e5dc", background="#f46b45")

    def _build_ui(self) -> None:
        root = ttk.Frame(self, style="App.TFrame", padding=22)
        root.pack(fill=BOTH, expand=True)

        header = ttk.Frame(root, style="App.TFrame")
        header.pack(fill=X)
        ttk.Label(header, text="Thu thập & duyệt quán ăn", style="Title.TLabel").pack(anchor=W)
        ttk.Label(
            header,
            text="Tìm dữ liệu công khai → kiểm tra trên màn hình → Approve vào hàng chờ Review.",
            style="Muted.TLabel",
        ).pack(anchor=W, pady=(4, 12))

        controls = ttk.Frame(root, style="Card.TFrame", padding=14)
        controls.pack(fill=X, pady=(0, 12))

        ttk.Label(controls, text="Quận / khu vực", style="Card.TLabel").grid(row=0, column=0, sticky=W, padx=(0, 8))
        district_entry = ttk.Entry(controls, textvariable=self.district_var, width=22)
        district_entry.grid(row=1, column=0, sticky=W, padx=(0, 12), pady=(5, 0))

        ttk.Label(controls, text="Loại địa điểm", style="Card.TLabel").grid(row=0, column=1, sticky=W, padx=(0, 8))
        category_box = ttk.Combobox(
            controls,
            textvariable=self.category_var,
            values=CATEGORY_VALUES,
            state="readonly",
            width=20,
        )
        category_box.grid(row=1, column=1, sticky=W, padx=(0, 12), pady=(5, 0))
        category_box.bind("<<ComboboxSelected>>", self._category_changed)

        ttk.Label(controls, text="Số lượng tối đa", style="Card.TLabel").grid(row=0, column=2, sticky=W, padx=(0, 8))
        limit_box = ttk.Spinbox(controls, from_=1, to=100, textvariable=self.limit_var, width=8)
        limit_box.grid(row=1, column=2, sticky=W, padx=(0, 12), pady=(5, 0))

        self.search_button = ttk.Button(controls, text="Tìm quán", command=self.search, style="Accent.TButton")
        self.search_button.grid(row=1, column=3, padx=(8, 6), pady=(5, 0))

        self.select_new_button = ttk.Button(controls, text="Chọn quán mới", command=self.select_new)
        self.select_new_button.grid(row=1, column=4, padx=6, pady=(5, 0))

        self.clear_selection_button = ttk.Button(controls, text="Bỏ chọn", command=self.clear_selection)
        self.clear_selection_button.grid(row=1, column=5, padx=6, pady=(5, 0))

        self.open_web_button = ttk.Button(controls, text="Mở trang Review", command=self.open_review_web)
        self.open_web_button.grid(row=1, column=6, padx=(6, 0), pady=(5, 0))

        self.progress = ttk.Progressbar(root, mode="indeterminate")
        self.progress.pack(fill=X, pady=(0, 8))

        status_row = ttk.Frame(root, style="App.TFrame")
        status_row.pack(fill=X, pady=(0, 8))
        ttk.Label(status_row, textvariable=self.status_var, style="Muted.TLabel").pack(side=LEFT)
        ttk.Label(status_row, textvariable=self.count_var, style="Muted.TLabel").pack(side=RIGHT)

        table_card = ttk.Frame(root, style="Card.TFrame", padding=12)
        table_card.pack(fill=BOTH, expand=True)

        ttk.Label(table_card, text="Kết quả tìm kiếm", style="CardHeading.TLabel").pack(anchor=W, pady=(0, 8))

        table_frame = ttk.Frame(table_card, style="Card.TFrame")
        table_frame.pack(fill=BOTH, expand=True)

        columns = ("name", "type", "food", "district", "street", "status")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="extended")
        headings = {
            "name": ("Tên quán", 260),
            "type": ("Phân loại", 120),
            "food": ("Món", 160),
            "district": ("Quận", 100),
            "street": ("Địa chỉ", 330),
            "status": ("Trạng thái", 120),
        }
        for column, (heading, width) in headings.items():
            self.tree.heading(column, text=heading)
            self.tree.column(column, width=width, anchor=W)

        scrollbar = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar.pack(side=RIGHT, fill=Y)
        self.tree.tag_configure("duplicate", foreground="#999999")
        self.tree.bind("<<TreeviewSelect>>", self._selection_changed)
        self.tree.bind("<Double-1>", self._open_map_for_row)

        action_row = ttk.Frame(table_card, style="Card.TFrame")
        action_row.pack(fill=X, pady=(10, 0))
        self.approve_button = ttk.Button(
            action_row,
            text="Approve → Đưa vào hàng chờ Review",
            command=self.approve_selected,
            style="Accent.TButton",
        )
        self.approve_button.pack(side=LEFT)
        ttk.Label(
            action_row,
            text="Bấm Ctrl/Shift để chọn nhiều dòng. Nhấp đúp một dòng để mở Google Maps.",
            style="Card.TLabel",
        ).pack(side=LEFT, padx=12)

        detail_card = ttk.Frame(root, style="Card.TFrame", padding=12)
        detail_card.pack(fill=X, pady=(12, 0))
        ttk.Label(detail_card, text="Nhật ký hoạt động", style="CardHeading.TLabel").pack(anchor=W)
        self.log_text = tk.Text(
            detail_card,
            height=5,
            wrap="word",
            bg="#fffdfb",
            fg="#374151",
            relief="flat",
            font=("Consolas", 9),
        )
        self.log_text.pack(fill=X, pady=(6, 0))
        self.log_text.configure(state="disabled")

    def _category_changed(self, _event=None) -> None:
        current = self.category_var.get()
        if current in CATEGORY_LABELS:
            self.category_var.set(current)

    def _refresh_config_status(self) -> None:
        url_ok = bool(os.environ.get("APPS_SCRIPT_URL", "").strip())
        token_ok = bool(os.environ.get("IMPORT_TOKEN", "").strip())
        if url_ok and token_ok:
            self._log("Đã đọc cấu hình .env: có thể Approve vào Review.")
        else:
            self._log("Thiếu APPS_SCRIPT_URL hoặc IMPORT_TOKEN: vẫn tìm được quán, nhưng chưa thể Approve.")

    def _log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert(END, text.rstrip() + "\n")
        self.log_text.see(END)
        self.log_text.configure(state="disabled")

    def _set_busy(self, busy: bool, message: str = "") -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.search_button.configure(state=state)
        self.approve_button.configure(state=state)
        self.select_new_button.configure(state=state)
        self.clear_selection_button.configure(state=state)
        if busy:
            self.progress.start(10)
        else:
            self.progress.stop()
        if message:
            self.status_var.set(message)

    def _selection_changed(self, _event=None) -> None:
        selected = len(self.tree.selection())
        self.status_var.set(f"Đã chọn {selected} quán." if selected else "Chưa chọn quán nào.")

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
        category = self.category_var.get().strip() or "all"
        limit = self._parse_limit()
        self._set_busy(True, "Đang tìm dữ liệu công khai…")
        self.count_var.set("Đang xử lý…")
        self._log(f"Bắt đầu tìm: {district or 'toàn TP.HCM'} • {CATEGORY_LABELS.get(category, category)} • tối đa {limit}")

        args = argparse.Namespace(district=district, category=category, limit=limit)

        def worker() -> None:
            output = io.StringIO()
            try:
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    candidates, endpoint = collector.collect(args)
                logs = output.getvalue()
                self.after(0, self._show_results, candidates, endpoint, logs)
            except Exception as error:
                logs = output.getvalue()
                self.after(0, self._show_error, f"{error}\n{logs}")

        threading.Thread(target=worker, daemon=True).start()

    def _show_results(self, candidates: list[dict], endpoint: str, logs: str) -> None:
        self._set_busy(False, "Đã tìm xong.")
        self.candidates = candidates
        self.tree.delete(*self.tree.get_children())

        for index, item in enumerate(candidates):
            status = "Đã có / trùng" if item.get("duplicate") else "Quán mới"
            tag = ("duplicate",) if item.get("duplicate") else ()
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

        fresh = sum(not item.get("duplicate") for item in candidates)
        duplicate = len(candidates) - fresh
        self.count_var.set(f"{len(candidates)} kết quả • {fresh} quán mới • {duplicate} trùng")
        self._log(logs or f"Nguồn: {endpoint}")
        self._log(f"Hoàn tất từ nguồn: {endpoint}")
        self.tree.selection_set([str(index) for index, item in enumerate(candidates) if not item.get("duplicate")])

    def _show_error(self, error: str) -> None:
        self._set_busy(False, "Có lỗi khi tìm dữ liệu.")
        self.count_var.set("Không có kết quả")
        self._log(error)
        messagebox.showerror("Không thể tìm quán", error[:2000])

    def select_new(self) -> None:
        ids = [str(index) for index, item in enumerate(self.candidates) if not item.get("duplicate")]
        self.tree.selection_set(ids)
        self._selection_changed()

    def clear_selection(self) -> None:
        self.tree.selection_remove(self.tree.selection())
        self._selection_changed()

    def _open_map_for_row(self, _event=None) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        item = self.candidates[int(selection[0])]
        url = item.get("mapUrl") or item.get("source")
        if url:
            webbrowser.open(url)

    def approve_selected(self) -> None:
        if self.busy:
            return
        selection = self.tree.selection()
        selected = [self.candidates[int(item_id)] for item_id in selection]
        selected = [item for item in selected if not item.get("duplicate")]
        if not selected:
            messagebox.showinfo("Chưa chọn quán", "Hãy chọn ít nhất một quán mới trước.")
            return
        if not os.environ.get("APPS_SCRIPT_URL") or not os.environ.get("IMPORT_TOKEN"):
            messagebox.showwarning(
                "Thiếu cấu hình",
                "Hãy điền APPS_SCRIPT_URL và IMPORT_TOKEN trong collector/.env.",
            )
            return
        if not messagebox.askyesno(
            "Xác nhận Approve",
            f"Đưa {len(selected)} quán vào hàng chờ Review trên web?",
        ):
            return

        self._set_busy(True, "Đang đưa quán vào hàng chờ Review…")
        self._log(f"Đang gửi {len(selected)} quán vào Apps Script…")

        def worker() -> None:
            try:
                response = collector.push_to_apps_script(selected)
                self.after(0, self._show_push_result, response)
            except Exception as error:
                self.after(0, self._show_push_error, str(error))

        threading.Thread(target=worker, daemon=True).start()

    def _show_push_result(self, response: dict) -> None:
        self._set_busy(False, "Đã gửi xong.")
        result = response.get("result", response) if isinstance(response, dict) else {}
        added = result.get("added", 0)
        skipped = result.get("skipped", 0)
        message = result.get("message", "Đã gửi dữ liệu.")
        self._log(f"{message} • thêm: {added}, bỏ qua: {skipped}")
        messagebox.showinfo("Hoàn tất", f"{message}\n\nThêm: {added}\nBỏ qua: {skipped}")
        if added:
            for item_id in self.tree.selection():
                self.tree.item(item_id, tags=("duplicate",))
        self.count_var.set(f"Đã gửi {added} quán vào Review; bỏ qua {skipped}.")

    def _show_push_error(self, error: str) -> None:
        self._set_busy(False, "Không gửi được dữ liệu.")
        self._log(f"Lỗi gửi Apps Script: {error}")
        messagebox.showerror("Lỗi gửi Apps Script", error[:2000])

    def open_review_web(self) -> None:
        url = os.environ.get("APPS_SCRIPT_URL", "").strip()
        if not url:
            messagebox.showwarning("Thiếu URL", "Hãy điền APPS_SCRIPT_URL trong collector/.env.")
            return
        webbrowser.open(url)


if __name__ == "__main__":
    CollectorApp().mainloop()
