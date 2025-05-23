import { Authenticator, AuthenticatorEvents } from "../../auth";
import { UIScreen, UIExamModeElements } from "../screen";
import { LoginScreenUI } from "./loginscreen";
import { ExamForHost, GreeterImage } from "../../data";

export class ExamModeUI extends UIScreen {
	public static readonly EXAM_USERNAME: string = 'exam';
	public static readonly EXAM_PASSWORD: string = 'exam';

	public readonly _form: UIExamModeElements;
	private _examMode: boolean = false;
	private _examIds: number[] = [];
	private _loginScreen: LoginScreenUI;
	private _examStartButtonEnableInterval: ReturnType<typeof setInterval> | null = null;
	private _examStartTime = new Date("2099-01-01T00:00:00Z"); // Set to a future date so that the button is disabled by default
	protected _events: AuthenticatorEvents = {
		authenticationStart: () => {
			this._disableForm();
		},
		authenticationComplete: () => {
			// TODO: add loading animation here
		},
		authenticationFailure: () => {
			this._enableForm();
			this._wigglePasswordInput();
		},
		errorMessage: (message: string) => {
			alert(message);
			window.ui.setDebugInfo(message);
		},
		infoMessage: (message: string) => {
			alert(message);
		},
	};

	public constructor(auth: Authenticator, loginUI: LoginScreenUI) {
		super(auth);

		// Keep a reference to the login screen so that we can show it when the exam is over
		this._loginScreen = loginUI;

		this._form = {
			form: document.getElementById('exam-form') as HTMLFormElement,
			examProjectsText: document.getElementById('exam-mode-projects') as HTMLSpanElement,
			examStartText: document.getElementById('exam-mode-start') as HTMLSpanElement,
			examEndText: document.getElementById('exam-mode-end') as HTMLSpanElement,
			loginInput: document.getElementById('exam-login') as HTMLInputElement,
			passwordInput: document.getElementById('exam-password') as HTMLInputElement,
			examStartButton: document.getElementById('exam-mode-start-button') as HTMLButtonElement,
			examStartTimer: document.getElementById('exam-mode-start-timer') as HTMLParagraphElement,
		} as UIExamModeElements;

		this._initForm();
	}

	/**
	 * Enable exam mode for a list of exams currently ongoing (usually just 1).
	 * If the array of exams is empty, nothing will happen.
	 */
	public enableExamMode(exams: ExamForHost[]): void {
		if (exams.length === 0) {
			return;
		}

		if (window.data.examLockScreenWallpaper) {
			let wallpaper: GreeterImage = window.data.examLockScreenWallpaper;
			let stripe: GreeterImage = window.data.examStripe;
			if (wallpaper.exists) {	
				document.body.style.backgroundImage = 'url("' + wallpaper.path + '")';
			}
			let intraCalendar = document.getElementById("intra-calendar");
			if (intraCalendar) {
				intraCalendar.style.display = "none";
			}
			if (stripe.exists) {
				let top = document.getElementById("top-stripe");
				let bottom = document.getElementById("bottom-stripe");
				if (top && bottom) {	
					top.style.background = 'url("' + stripe.path + '") repeat-x';
					bottom.style.background = 'url("' + stripe.path + '") repeat-x';
					top.style.backgroundSize = '150px';
					bottom.style.backgroundSize = '150px';
				}
			}
		}


		this._examMode = true;
		this._examIds = exams.map((exam) => exam.id);
		this._populateData(exams);
		this._loginScreen.hideForm();
		this.showForm();
	}

	/**
	 * Disable exam mode and show the default login screen instead.
	 */
	public disableExamMode(): void {

		let wallpaper: GreeterImage = window.data.loginScreenWallpaper;
		if (wallpaper.exists) {
			document.body.style.backgroundImage = 'url("' + wallpaper.path + '")';
		} else {
			document.body.style.backgroundColor = 'black';
			document.body.style.backgroundImage = 'none';
		}
		let intraCalendar = document.getElementById("intra-calendar");
		if (intraCalendar) {
			intraCalendar.style.removeProperty("display");
		}
		this._examMode = false;
		this._examIds = [];
		this._populateData([]);
		this.hideForm();
		this._loginScreen.showForm();
	}

	/**
	 * Get whether the exam mode screen is currently displayed.
	 */
	public get examMode(): boolean {
		return this._examMode;
	}

	/**
	 * Get the ids of the exams that are currently displayed on the exam mode screen.
	 */
	public get examIds(): number[] {
		return this._examIds;
	}

	protected _initForm(): void {
		const form = this._form as UIExamModeElements;

		// This event gets called when the user clicks the unlock button or submits the lock screen form in any other way
		form.examStartButton.addEventListener('click', (event: Event) => {
			event.preventDefault();
			if (this._examMode) {
				if (form.loginInput.value === ExamModeUI.EXAM_USERNAME && form.passwordInput.value === ExamModeUI.EXAM_PASSWORD) {
					this._auth.login(ExamModeUI.EXAM_USERNAME, ExamModeUI.EXAM_PASSWORD);
				} else {
					this._wigglePasswordInput();
				}
			}
		});

		form.loginInput.addEventListener("input", () => {
			this._enableOrDisableSubmitButton();
		});
		form.passwordInput.addEventListener("input", () => {
			this._enableOrDisableSubmitButton();
		});
	}

	private _clearExamStartTimer(): void {
		const form = this._form as UIExamModeElements;
		if (this._examStartButtonEnableInterval) {
			clearTimeout(this._examStartButtonEnableInterval);
			this._examStartButtonEnableInterval = null;
		}
		form.examStartTimer.innerText = "Click the arrow below to start your exam.";
		this._enableOrDisableSubmitButton();
	}

	private _populateData(examsToPopulate: ExamForHost[]): void {
		const form = this._form as UIExamModeElements;

		if (examsToPopulate.length === 0) {
			// Unset text that states which exams can be started today
			form.examProjectsText.innerText = '';
			form.examStartText.innerText = 'unknown';
			form.examEndText.innerText = 'unknown';
			// Clear the timeout for the exam start button and disable it
			this._examStartTime = new Date("2099-01-01T00:00:00Z");
			this._clearExamStartTimer();
		}
		else {
			// Find all exams in the data.json file that match the ids in the exams variable
			const exams = window.data.dataJson?.exams.filter((exam) => examsToPopulate.some((examToPopulate) => exam.id === examToPopulate.id));

			if (exams === undefined) {
				console.error('Failed to find exams in data.json');
				window.ui.setDebugInfo('Failed to find exams in data.json');
				return;
			}

			// Find the earliest start time for an exam that should be displayed right now
			const earliestExam = exams.reduce((earliest, exam) => {
				const beginAt = new Date(exam.begin_at);
				if (earliest === null || beginAt < earliest) {
					return beginAt;
				}
				return earliest;
			}, new Date(exams[0].begin_at));

			// Find the latest end time for an exam that should be displayed right now
			const latestExam = exams.reduce((latest, exam) => {
				const endAt = new Date(exam.end_at);
				if (latest === null || endAt > latest) {
					return endAt;
				}
				return latest;
			}, new Date(exams[0].end_at));

			// Combine all possible projects for exams that can be started right now
			const projectsText = exams.flatMap((exam) => exam.projects.map((project) => project.name)).join(', ');

			// Display the projects and the time range in which the exams can be started
			form.examProjectsText.innerText = projectsText;
			form.examStartText.innerText = earliestExam.toLocaleTimeString("en-NL", { hour: '2-digit', minute: '2-digit' });
			form.examEndText.innerText = latestExam.toLocaleTimeString("en-NL", { hour: '2-digit', minute: '2-digit' });

			// Enable or disable the exam start button based on the current time
			this._clearExamStartTimer();
			this._examStartTime = earliestExam;
			this._enableOrDisableSubmitButton();
			if (this._examStartTime.getTime() > Date.now()) {
				this._examStartButtonEnableInterval = setInterval(() => {
					const timeLeft = Math.floor((this._examStartTime.getTime() - Date.now()) / 1000);
					const minutes = Math.floor(timeLeft / 60);
					const seconds = timeLeft % 60;
					const formattedTime = `${(minutes > 0 ? `${minutes} minutes and ` : '')} ${seconds} seconds`;
					form.examStartTimer.innerText = `You may start your exam in ${formattedTime}.`;

					if (this._examStartTime.getTime() <= Date.now()) {
						// Clear the timer and enable the button
						this._clearExamStartTimer();
						return;
					}
				}, 1000);
			}
		}
	}

	// Returns true if the exam-start button is disabled, false otherwise
	protected _enableOrDisableSubmitButton(): boolean {
		const form = this._form as UIExamModeElements;
		const buttonDisabled = this._examStartTime.getTime() > Date.now(); // Disable the button if the exam start time is in the future
		form.examStartButton.disabled = buttonDisabled;
		if (!buttonDisabled) {
			form.examStartTimer.innerText = "Click the arrow below to start your exam.";
			const focusInput = this._getInputToFocusOn();
			if (focusInput) {
				focusInput.focus();
			}
		}
		return buttonDisabled;
	}

	protected _wigglePasswordInput(clearInput: boolean = true): void {
		const passwordInput = (this._form as UIExamModeElements).passwordInput;
		passwordInput.classList.add('wiggle');
		passwordInput.addEventListener('keydown', () => {
			passwordInput.classList.remove('wiggle');
		}, { once: true });

		if (clearInput) {
			passwordInput.value = "";
			passwordInput.focus();
			this._enableOrDisableSubmitButton();
		}
	}

	protected _getInputToFocusOn(): HTMLButtonElement | null {
		return null; // Don't focus on any input field, there are none.
		// There is a button we could focus on but then pressing enter/space will trigger the button even when the display is blanking
	}
}
