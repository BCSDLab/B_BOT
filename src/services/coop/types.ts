export type RegularTermName = "1학기" | "2학기";

export interface RawOperationHour {
  dayLabel: string;
  type: string;
  openTime: string;
  closeTime: string;
  rawText: string;
}

export interface RawCoopShop {
  groupLabel: string;
  shopLabel: string;
  phone: string;
  remark: string;
  operationHours: RawOperationHour[];
}

/** 비전 모델이 이미지에서 읽어낸 원문 중심의 중간 표현. */
export interface RawRegularCoopTimetable {
  title: string;
  semesterLabel: string;
  fromDate: string;
  toDate: string;
  shops: RawCoopShop[];
}
