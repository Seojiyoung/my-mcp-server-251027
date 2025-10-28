import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { HfInference } from '@huggingface/inference'
import { Buffer } from 'buffer'

export const configSchema = z.object({
    HF_TOKEN: z.string().describe("Hugging Face API Token for image generation")
})

export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {

    // 언어별 인사말 매핑
    const greetings: Record<string, string> = {
        korean: '안녕하세요',
        english: 'Hello',
        spanish: 'Hola',
        french: 'Bonjour',
        japanese: 'こんにちは',
        chinese: '你好',
        german: 'Guten Tag',
        italian: 'Ciao',
        russian: 'Привет',
        portuguese: 'Olá',
    }

    // Create server instance
    const server = new McpServer({
        name: 'greeting-server',
        version: '1.0.0',
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    })

    // Greeting 도구 추가
    server.tool(
        'greeting',
        '사용자의 이름과 원하는 언어를 받아서 해당 언어로 인사합니다',
        {
            name: z.string().describe('인사할 사용자의 이름'),
            language: z.enum([
                'korean',
                'english', 
                'spanish',
                'french',
                'japanese',
                'chinese',
                'german',
                'italian',
                'russian',
                'portuguese'
            ]).describe('인사할 언어 (korean, english, spanish, french, japanese, chinese, german, italian, russian, portuguese 중 선택)'),
        },
        async ({ name, language }: { name: string; language: 'korean' | 'english' | 'spanish' | 'french' | 'japanese' | 'chinese' | 'german' | 'italian' | 'russian' | 'portuguese' }) => {
            const greeting = greetings[language]
            const message = `${greeting}, ${name}!`
            
            return {
                content: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            }
        }
    )

    // Calculator 도구 추가
    server.tool(
        'calculator',
        '두 개의 숫자를 입력받아 사칙연산(+, -, *, /)을 수행합니다',
        {
            num1: z.number().describe('첫 번째 숫자'),
            num2: z.number().describe('두 번째 숫자'),
            operator: z.enum(['+', '-', '*', '/']).describe('연산자 (+, -, *, / 중 선택)'),
        },
        async ({ num1, num2, operator }: { num1: number; num2: number; operator: '+' | '-' | '*' | '/' }) => {
            let result: number
            let operationName: string
            
            switch (operator) {
                case '+':
                    result = num1 + num2
                    operationName = '덧셈'
                    break
                case '-':
                    result = num1 - num2
                    operationName = '뺄셈'
                    break
                case '*':
                    result = num1 * num2
                    operationName = '곱셈'
                    break
                case '/':
                    if (num2 === 0) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: '오류: 0으로 나눌 수 없습니다!'
                                }
                            ],
                            isError: true
                        }
                    }
                    result = num1 / num2
                    operationName = '나눗셈'
                    break
            }
            
            const message = `${operationName} 결과: ${num1} ${operator} ${num2} = ${result}`
            
            return {
                content: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            }
        }
    )

    // Current Time 도구 추가
    server.tool(
        'current-time',
        '지정된 타임존의 현재 시간을 반환합니다. 타임존을 지정하지 않으면 한국 시간을 반환합니다.',
        {
            timezone: z.string().optional().describe('IANA 타임존 형식 (예: Asia/Seoul, America/New_York, Europe/London). 지정하지 않으면 Asia/Seoul(한국 시간) 사용'),
        },
        async ({ timezone }: { timezone?: string }) => {
            const targetTimezone = timezone || 'Asia/Seoul'
            
            try {
                const now = new Date()
                
                // 타임존에 맞는 현재 시간 포맷팅
                const dateOptions: Intl.DateTimeFormatOptions = {
                    timeZone: targetTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }
                
                const formattedTime = now.toLocaleString('ko-KR', dateOptions)
                
                // 타임존 이름 가져오기
                const timezoneName = new Intl.DateTimeFormat('ko-KR', {
                    timeZone: targetTimezone,
                    timeZoneName: 'long'
                }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || targetTimezone
                
                const message = `${timezoneName}의 현재 시간: ${formattedTime}`
                
                return {
                    content: [
                        {
                            type: 'text',
                            text: message
                        }
                    ]
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `오류: 유효하지 않은 타임존입니다. (입력값: ${targetTimezone})\nIANA 타임존 형식을 사용해주세요 (예: Asia/Seoul, America/New_York)`
                        }
                    ],
                    isError: true
                }
            }
        }
    )

    // Image Generation 도구 추가
    server.tool(
        'generate-image',
        '텍스트 프롬프트를 입력받아 AI 이미지를 생성합니다',
        {
            prompt: z.string().describe('생성할 이미지를 설명하는 텍스트 프롬프트'),
        },
        async ({ prompt }: { prompt: string }) => {
            try {
                const client = new HfInference(config.HF_TOKEN)
                
                const imageBlob = await client.textToImage({
                    model: 'black-forest-labs/FLUX.1-schnell',
                    inputs: prompt,
                })
                
                // Blob을 ArrayBuffer로 변환
                const arrayBuffer = await imageBlob.arrayBuffer()
                // ArrayBuffer를 Buffer로 변환 후 base64 인코딩
                const buffer = Buffer.from(arrayBuffer)
                const base64Data = buffer.toString('base64')
                
                return {
                    content: [
                        {
                            type: 'image',
                            data: base64Data,
                            mimeType: 'image/png'
                        }
                    ],
                    annotations: {
                        audience: ['user'],
                        priority: 0.9
                    }
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `이미지 생성 오류: ${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}\n\nHF_TOKEN 설정이 올바른지 확인해주세요.`
                        }
                    ],
                    isError: true
                }
            }
        }
    )

    // Server Info 리소스 추가
    server.resource(
        'server-info',
        'server://info',
        {
            description: '현재 MCP 서버의 상세 정보를 반환합니다',
            mimeType: 'application/json'
        },
        async () => {
            const serverInfo = {
                name: 'greeting-server',
                version: '1.0.0',
                description: '다국어 인사, 계산기, 현재 시간, 이미지 생성, 코드 리뷰를 제공하는 MCP 서버',
                capabilities: {
                    tools: ['greeting', 'calculator', 'current-time', 'generate-image'],
                    resources: ['server-info'],
                    prompts: ['code_review']
                },
                supportedLanguages: Object.keys(greetings),
                features: [
                    {
                        name: 'greeting',
                        description: '10개 언어로 개인화된 인사말 제공',
                        languages: Object.keys(greetings)
                    },
                    {
                        name: 'calculator',
                        description: '기본 사칙연산 지원 (덧셈, 뺄셈, 곱셈, 나눗셈)',
                        operations: ['+', '-', '*', '/']
                    },
                    {
                        name: 'current-time',
                        description: 'IANA 타임존 기반 현재 시간 조회',
                        defaultTimezone: 'Asia/Seoul'
                    },
                    {
                        name: 'generate-image',
                        description: 'AI 텍스트-이미지 생성 (FLUX.1-schnell 모델 사용)',
                        parameters: ['prompt']
                    },
                    {
                        name: 'code_review',
                        description: '상세한 코드 리뷰 프롬프트 생성 (품질, 버그, 성능, 보안, 스타일 등 7가지 항목 분석)',
                        parameters: ['code', 'language (optional)', 'focus (optional)']
                    }
                ],
                author: 'MCP Server',
                lastUpdated: new Date().toISOString()
            }
            
            return {
                contents: [
                    {
                        uri: 'server://info',
                        mimeType: 'application/json',
                        text: JSON.stringify(serverInfo, null, 2)
                    }
                ]
            }
        }
    )

    // Code Review 프롬프트 추가
    server.prompt(
        'code_review',
        '사용자의 코드를 입력받아 상세한 코드 리뷰를 수행하는 프롬프트를 생성합니다',
        {
            code: z.string().describe('리뷰할 코드'),
            language: z.string().optional().describe('프로그래밍 언어 (예: TypeScript, Python, Java 등)'),
            focus: z.string().optional().describe('특정 리뷰 초점 (예: 성능, 보안, 가독성 등)')
        },
        async ({ code, language, focus }: { code: string; language?: string; focus?: string }) => {
            const languageInfo = language ? `\n**프로그래밍 언어**: ${language}` : ''
            const focusInfo = focus ? `\n**리뷰 초점**: ${focus}` : ''
            
            const prompt = `다음 코드에 대한 상세한 코드 리뷰를 수행해주세요.${languageInfo}${focusInfo}

    ## 검토할 코드
    \`\`\`${language || ''}
    ${code}
    \`\`\`

    ## 코드 리뷰 가이드라인

    다음 항목들을 중심으로 상세하게 분석해주세요:

    ### 1. 코드 품질 분석
    - 전체적인 코드 구조와 설계 패턴 평가
    - 코드의 명확성과 의도 전달 여부
    - 복잡도 분석 (순환 복잡도, 중첩 깊이 등)

    ### 2. 버그 및 잠재적 문제점
    - 명백한 버그나 논리적 오류 발견
    - Edge case 처리 누락
    - Null/Undefined 체크 누락
    - 타입 관련 문제
    - 예외 처리 미흡

    ### 3. 성능 최적화
    - 불필요한 연산이나 반복
    - 메모리 누수 가능성
    - 비효율적인 알고리즘이나 자료구조 사용
    - 캐싱 기회
    - 비동기 처리 개선점

    ### 4. 보안 취약점
    - 입력 검증 부족
    - SQL Injection, XSS 등 보안 위협
    - 민감한 정보 노출
    - 권한 검증 누락
    - 안전하지 않은 의존성 사용

    ### 5. 코드 스타일 및 가독성
    - 네이밍 컨벤션 준수 여부
    - 코드 포맷팅 및 일관성
    - 주석의 적절성 (과다/부족)
    - 매직 넘버/스트링 사용
    - 함수/클래스 크기의 적절성

    ### 6. 모범 사례 준수
    - 언어별 관용구(idiom) 활용
    - SOLID 원칙 준수
    - DRY (Don't Repeat Yourself) 원칙
    - 적절한 디자인 패턴 적용
    - 테스트 가능성

    ### 7. 유지보수성
    - 코드의 확장 가능성
    - 의존성 관리
    - 결합도와 응집도
    - 리팩토링 필요성

    ## 리뷰 형식

    각 항목에 대해:
    - ✅ **잘된 점**: 긍정적인 부분 강조
    - ⚠️ **개선 필요**: 문제점과 이유 설명
    - 💡 **제안**: 구체적인 개선 코드 예시 제공
    - 🔍 **추가 고려사항**: 장기적 관점의 제안

    마지막에 **종합 평가**와 **우선순위별 개선 사항**을 정리해주세요.`

            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt
                        }
                    }
                ]
            }
        }
    )

    // 서버 시작
    // async function main() {
    //     const transport = new StdioServerTransport()
    //     await server.connect(transport)
    //     console.error('Greeting MCP Server running on stdio')
    // }

    // main().catch((error) => {
    //     console.error('Server error:', error)
    //     process.exit(1)
    // })

    return server.server
}