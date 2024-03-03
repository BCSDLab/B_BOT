export const TRACKS_LOWERCASE = ["frontend", "backend", "android", "uiux", "ios", "game"] as const;

export const TRACKS_KOREAN = ["프론트엔드", "벡엔드", "안드로이드", "유아이유엑스", "아이오세스", "게임", "프엔", "벡엔", "안드"] as const;

export const TRACK_NAME_MAPPER = {
  "frontend": "FrontEnd",
  "backend": "BackEnd",
  "android": "Android",
  "uiux": "UI/UX",
  "ios": "iOS",
  "game": "Game",
} as const;

export const TRACK_NAME_KOREAN_MAPPER = {
  "프론트엔드": "frontend",
  "벡엔드": "backend",
  "안드로이드": "android",
  "유아이유엑스": "uiux",
  "아이오에스": "ios",
  "게임": "game",
  "프엔": "frontend",
  "벡엔": "backend",
  "안드": "android",
} as const;

export const MEMBER_TYPES_KOREAN_MAPPER = {
  "비기너": "beginner",
  "레귤러": "regular",
  "멘토": "mentor" 
}
export const MEMBER_TYPES_LOWERCASE = ["beginner", "regular", "mentor"] as const;

export const MEMBER_TYPES_KOREAN = ["비기너", "레귤러", "멘토"] as const;
